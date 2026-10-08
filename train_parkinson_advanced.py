#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageEnhance, ImageFilter
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def pil_to_tensor(image: Image.Image) -> torch.Tensor:
    arr = np.asarray(image, dtype=np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.expand_dims(arr, axis=-1)
    arr = np.transpose(arr, (2, 0, 1))
    return torch.from_numpy(arr)


class Compose:
    def __init__(self, transforms: Sequence[Callable[[Image.Image], Image.Image]]) -> None:
        self.transforms = list(transforms)

    def __call__(self, image: Image.Image) -> Image.Image:
        for t in self.transforms:
            image = t(image)
        return image


class Resize:
    def __init__(self, size: int) -> None:
        self.size = size

    def __call__(self, image: Image.Image) -> Image.Image:
        return image.resize((self.size, self.size), Image.BILINEAR)


class RandomHorizontalFlip:
    def __init__(self, p: float = 0.5) -> None:
        self.p = p

    def __call__(self, image: Image.Image) -> Image.Image:
        if random.random() < self.p:
            return image.transpose(Image.FLIP_LEFT_RIGHT)
        return image


class RandomRotate:
    def __init__(self, max_degrees: float = 12.0) -> None:
        self.max_degrees = max_degrees

    def __call__(self, image: Image.Image) -> Image.Image:
        angle = random.uniform(-self.max_degrees, self.max_degrees)
        return image.rotate(angle, resample=Image.BILINEAR)


class RandomBrightnessContrast:
    def __init__(self, brightness: float = 0.2, contrast: float = 0.2, p: float = 0.7) -> None:
        self.brightness = brightness
        self.contrast = contrast
        self.p = p

    def __call__(self, image: Image.Image) -> Image.Image:
        if random.random() < self.p:
            b = random.uniform(1.0 - self.brightness, 1.0 + self.brightness)
            c = random.uniform(1.0 - self.contrast, 1.0 + self.contrast)
            image = ImageEnhance.Brightness(image).enhance(b)
            image = ImageEnhance.Contrast(image).enhance(c)
        return image


class TremorEmphasis:
    """Applies high-pass filtering (UnsharpMask / Edge Enhance) to explicitly 
    highlight jagged strokes, micro-tremors, and vibrations for the CNN."""
    def __init__(self, radius: float = 2.0, percent: int = 150) -> None:
        self.radius = radius
        self.percent = percent

    def __call__(self, image: Image.Image) -> Image.Image:
        # Enhances high-frequency data (shaking/vibrations)
        image = image.filter(ImageFilter.UnsharpMask(radius=self.radius, percent=self.percent, threshold=3))
        # Further accentuate the edges
        image = image.filter(ImageFilter.EDGE_ENHANCE_MORE)
        return image


@dataclass
class Sample:
    path: Path
    label: int


class ParkinsonDataset(Dataset):
    def __init__(
        self,
        samples: Sequence[Sample],
        image_size: int,
        mean: Sequence[float],
        std: Sequence[float],
        augment: bool,
    ) -> None:
        self.samples = list(samples)
        self.image_size = image_size
        self.mean = torch.tensor(mean, dtype=torch.float32).view(3, 1, 1)
        self.std = torch.tensor(std, dtype=torch.float32).view(3, 1, 1)
        self.augment = augment
        self.train_transforms = Compose(
            [
                Resize(int(self.image_size * 1.15)), # Resize slightly larger
                TremorEmphasis(radius=2.0, percent=150), # Highlight strokes and vibrations
                RandomRotate(max_degrees=25), # Aggressive rotation
                RandomHorizontalFlip(p=0.5), # 50% flip
                RandomBrightnessContrast(brightness=0.25, contrast=0.25, p=0.6), # High probability jitter
                Resize(self.image_size), # Bring back to target size (pseudo random crop)
            ]
        )
        self.eval_transforms = Compose([
            TremorEmphasis(radius=2.0, percent=150), # Must apply same tremor highlight in eval
            Resize(self.image_size)
        ])

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        sample = self.samples[idx]
        with Image.open(sample.path) as img:
            image = img.convert("RGB")
        if self.augment:
            image = self.train_transforms(image)
        else:
            image = self.eval_transforms(image)
        tensor = pil_to_tensor(image)
        tensor = (tensor - self.mean) / self.std
        return tensor, sample.label


def collect_samples(data_dir: Path) -> tuple[list[Sample], dict[int, str]]:
    class_dirs = [d for d in sorted(data_dir.iterdir()) if d.is_dir()]
    if len(class_dirs) < 2:
        raise ValueError(f"Expected at least 2 class folders under {data_dir}, found {len(class_dirs)}")
    idx_to_class = {i: class_dir.name for i, class_dir in enumerate(class_dirs)}
    samples: list[Sample] = []
    for label, class_dir in enumerate(class_dirs):
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.bmp"):
            for path in class_dir.rglob(ext):
                samples.append(Sample(path=path, label=label))
    if not samples:
        raise ValueError(f"No images found inside {data_dir}")
    return samples, idx_to_class


def split_samples(
    samples: Sequence[Sample],
    val_size: float,
    test_size: float,
    seed: int,
) -> tuple[list[Sample], list[Sample], list[Sample]]:
    if val_size <= 0 or test_size <= 0 or val_size + test_size >= 1:
        raise ValueError("val_size and test_size must be >0 and val_size + test_size < 1")
    labels = [s.label for s in samples]
    train_samples, temp_samples = train_test_split(
        list(samples),
        test_size=val_size + test_size,
        stratify=labels,
        random_state=seed,
    )
    temp_labels = [s.label for s in temp_samples]
    relative_test = test_size / (val_size + test_size)
    val_samples, test_samples = train_test_split(
        temp_samples,
        test_size=relative_test,
        stratify=temp_labels,
        random_state=seed,
    )
    return train_samples, val_samples, test_samples


def estimate_channel_stats(samples: Sequence[Sample], image_size: int, max_items: int = 800) -> tuple[list[float], list[float]]:
    picked = list(samples)
    random.shuffle(picked)
    picked = picked[: min(max_items, len(picked))]

    channel_sum = np.zeros(3, dtype=np.float64)
    channel_sq_sum = np.zeros(3, dtype=np.float64)
    num_pixels = 0
    resize = Resize(image_size)

    for sample in picked:
        with Image.open(sample.path) as img:
            image = resize(img.convert("RGB"))
        arr = np.asarray(image, dtype=np.float32) / 255.0
        arr = arr.reshape(-1, 3)
        channel_sum += arr.sum(axis=0)
        channel_sq_sum += np.square(arr).sum(axis=0)
        num_pixels += arr.shape[0]

    mean = channel_sum / max(1, num_pixels)
    var = channel_sq_sum / max(1, num_pixels) - np.square(mean)
    std = np.sqrt(np.clip(var, 1e-8, None))
    return mean.tolist(), std.tolist()


class SEBlock(nn.Module):
    def __init__(self, channels: int, reduction: int = 8) -> None:
        super().__init__()
        hidden = max(8, channels // reduction)
        self.fc1 = nn.Linear(channels, hidden)
        self.fc2 = nn.Linear(hidden, channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.shape
        y = F.adaptive_avg_pool2d(x, 1).view(b, c)
        y = F.silu(self.fc1(y))
        y = torch.sigmoid(self.fc2(y)).view(b, c, 1, 1)
        return x * y


class ResidualSEBlock(nn.Module):
    def __init__(self, in_ch: int, out_ch: int, stride: int = 1, dropout: float = 0.0) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(in_ch, out_ch, 3, stride=stride, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(out_ch)
        self.conv2 = nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(out_ch)
        self.se = SEBlock(out_ch)
        self.dropout = nn.Dropout2d(dropout) if dropout > 0 else nn.Identity()
        if stride != 1 or in_ch != out_ch:
            self.shortcut = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, 1, stride=stride, bias=False),
                nn.BatchNorm2d(out_ch),
            )
        else:
            self.shortcut = nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = self.shortcut(x)
        out = F.silu(self.bn1(self.conv1(x)))
        out = self.dropout(out)
        out = self.bn2(self.conv2(out))
        out = self.se(out)
        out = F.silu(out + residual)
        return out


class CustomParkinsonCNN(nn.Module):
    def __init__(self, num_classes: int = 2, dropout: float = 0.5, width_mult: float = 1.0) -> None:
        super().__init__()
        c1 = max(32, int(32 * width_mult))
        c2 = max(64, int(64 * width_mult))
        c3 = max(128, int(128 * width_mult))
        c4 = max(256, int(256 * width_mult))
        
        self.stem = nn.Sequential(
            nn.Conv2d(3, c1, kernel_size=7, stride=2, padding=3, bias=False),
            nn.BatchNorm2d(c1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
        )
        self.stage1 = nn.Sequential(
            ResidualSEBlock(c1, c1, stride=1, dropout=0.0),
            ResidualSEBlock(c1, c1, stride=1, dropout=0.0),
        )
        self.stage2 = nn.Sequential(
            ResidualSEBlock(c1, c2, stride=2, dropout=0.05),
            ResidualSEBlock(c2, c2, stride=1, dropout=0.05),
        )
        self.stage3 = nn.Sequential(
            ResidualSEBlock(c2, c3, stride=2, dropout=0.1),
            ResidualSEBlock(c3, c3, stride=1, dropout=0.1),
        )
        self.stage4 = nn.Sequential(
            ResidualSEBlock(c3, c4, stride=2, dropout=0.2),
            ResidualSEBlock(c4, c4, stride=1, dropout=0.2),
        )
        
        self.head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(c4, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = self.stage4(x)
        return self.head(x)


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray, y_prob: np.ndarray) -> dict[str, float]:
    metrics = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }
    try:
        metrics["roc_auc"] = float(roc_auc_score(y_true, y_prob))
    except ValueError:
        metrics["roc_auc"] = float("nan")
    return metrics


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
) -> tuple[float, dict[str, float], list[list[int]]]:
    model.eval()
    running_loss = 0.0
    y_true_all: list[int] = []
    y_pred_all: list[int] = []
    y_prob_all: list[float] = []

    with torch.no_grad():
        for inputs, labels in loader:
            inputs = inputs.to(device)
            labels = labels.to(device)
            logits = model(inputs)
            loss = criterion(logits, labels)
            probs = torch.softmax(logits, dim=1)[:, 1]
            preds = torch.argmax(logits, dim=1)

            running_loss += loss.item() * inputs.size(0)
            y_true_all.extend(labels.cpu().numpy().tolist())
            y_pred_all.extend(preds.cpu().numpy().tolist())
            y_prob_all.extend(probs.cpu().numpy().tolist())

    y_true = np.asarray(y_true_all)
    y_pred = np.asarray(y_pred_all)
    y_prob = np.asarray(y_prob_all)
    avg_loss = running_loss / max(1, len(loader.dataset))
    metrics = compute_metrics(y_true, y_pred, y_prob)
    cm = confusion_matrix(y_true, y_pred).tolist()
    return avg_loss, metrics, cm


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> float:
    model.train()
    running_loss = 0.0

    for inputs, labels in loader:
        inputs = inputs.to(device)
        labels = labels.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(inputs)
        loss = criterion(logits, labels)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        running_loss += loss.item() * inputs.size(0)

    return running_loss / max(1, len(loader.dataset))


def count_labels(samples: Sequence[Sample], idx_to_class: dict[int, str]) -> dict[str, int]:
    counts = {idx_to_class[i]: 0 for i in sorted(idx_to_class)}
    for sample in samples:
        counts[idx_to_class[sample.label]] += 1
    return counts


def train(args: argparse.Namespace) -> None:
    set_seed(args.seed)
    data_dir = Path(args.data_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    samples, idx_to_class = collect_samples(data_dir)
    train_samples, val_samples, test_samples = split_samples(
        samples=samples,
        val_size=args.val_size,
        test_size=args.test_size,
        seed=args.seed,
    )

    mean, std = estimate_channel_stats(train_samples, image_size=args.image_size)
    print(f"Estimated mean: {mean}")
    print(f"Estimated std:  {std}")
    print("Split sizes:")
    print(f"  Train: {len(train_samples)} {count_labels(train_samples, idx_to_class)}")
    print(f"  Val:   {len(val_samples)} {count_labels(val_samples, idx_to_class)}")
    print(f"  Test:  {len(test_samples)} {count_labels(test_samples, idx_to_class)}")

    train_ds = ParkinsonDataset(train_samples, args.image_size, mean, std, augment=True)
    val_ds = ParkinsonDataset(val_samples, args.image_size, mean, std, augment=False)
    test_ds = ParkinsonDataset(test_samples, args.image_size, mean, std, augment=False)

    workers = min(args.num_workers, max(1, os.cpu_count() or 1))
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=workers,
        pin_memory=torch.cuda.is_available(),
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=workers,
        pin_memory=torch.cuda.is_available(),
    )
    test_loader = DataLoader(
        test_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=workers,
        pin_memory=torch.cuda.is_available(),
    )

    device = get_device()
    print(f"Using device: {device}")
    model = CustomParkinsonCNN(
        num_classes=len(idx_to_class),
        dropout=args.dropout,
        width_mult=args.width_mult,
    ).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=args.lr * 0.05)

    best_f1 = -math.inf
    best_epoch = -1
    wait = 0
    history: list[dict[str, float]] = []
    checkpoint_path = output_dir / "best_model.pt"

    for epoch in range(1, args.epochs + 1):
        start_time = time.time()
        train_loss = train_one_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_metrics, val_cm = evaluate(model, val_loader, criterion, device)
        scheduler.step()

        current_lr = optimizer.param_groups[0]["lr"]
        record = {
            "epoch": float(epoch),
            "lr": float(current_lr),
            "train_loss": float(train_loss),
            "val_loss": float(val_loss),
            **{f"val_{k}": float(v) for k, v in val_metrics.items()},
        }
        history.append(record)
        elapsed = time.time() - start_time

        print(
            f"Epoch {epoch:03d}/{args.epochs} | "
            f"train_loss={train_loss:.4f} val_loss={val_loss:.4f} "
            f"val_acc={val_metrics['accuracy']:.4f} val_f1={val_metrics['f1']:.4f} "
            f"val_auc={val_metrics['roc_auc']:.4f} lr={current_lr:.6f} "
            f"time={elapsed:.1f}s"
        )

        if val_metrics["f1"] > best_f1:
            best_f1 = val_metrics["f1"]
            best_epoch = epoch
            wait = 0
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "idx_to_class": idx_to_class,
                    "mean": mean,
                    "std": std,
                    "image_size": args.image_size,
                    "width_mult": args.width_mult,
                    "dropout": args.dropout,
                    "epoch": epoch,
                    "val_metrics": val_metrics,
                    "val_confusion_matrix": val_cm,
                },
                checkpoint_path,
            )
            print(f"  Saved new best model -> {checkpoint_path}")
        else:
            wait += 1
            if wait >= args.patience:
                print(f"Early stopping triggered at epoch {epoch}. Best epoch: {best_epoch}")
                break

    checkpoint = torch.load(checkpoint_path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])
    test_loss, test_metrics, test_cm = evaluate(model, test_loader, criterion, device)

    report = {
        "config": vars(args),
        "device": str(device),
        "class_mapping": {str(k): v for k, v in idx_to_class.items()},
        "dataset_size": len(samples),
        "split_counts": {
            "train": count_labels(train_samples, idx_to_class),
            "val": count_labels(val_samples, idx_to_class),
            "test": count_labels(test_samples, idx_to_class),
        },
        "normalization": {"mean": mean, "std": std},
        "best_epoch": best_epoch,
        "best_val_f1": best_f1,
        "test_loss": test_loss,
        "test_metrics": test_metrics,
        "test_confusion_matrix": test_cm,
        "history": history,
    }

    metrics_path = output_dir / "metrics.json"
    with metrics_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\nFinal Test Metrics:")
    print(json.dumps(test_metrics, indent=2))
    print(f"Confusion matrix: {test_cm}")
    print(f"Saved artifacts:")
    print(f"  Model:   {checkpoint_path}")
    print(f"  Metrics: {metrics_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train an advanced Parkinson disease classifier.")
    parser.add_argument("--data-dir", type=str, default="Train", help="Path containing class subfolders.")
    parser.add_argument("--output-dir", type=str, default="artifacts", help="Directory to save model and metrics.")
    parser.add_argument("--epochs", type=int, default=35, help="Max training epochs.")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size.")
    parser.add_argument("--image-size", type=int, default=224, help="Input image size.")
    parser.add_argument("--lr", type=float, default=3e-4, help="Initial learning rate.")
    parser.add_argument("--weight-decay", type=float, default=1e-4, help="Weight decay.")
    parser.add_argument("--dropout", type=float, default=0.35, help="Classifier dropout.")
    parser.add_argument("--label-smoothing", type=float, default=0.04, help="Cross-entropy label smoothing.")
    parser.add_argument("--width-mult", type=float, default=1.0, help="Model width multiplier.")
    parser.add_argument("--val-size", type=float, default=0.15, help="Validation split ratio.")
    parser.add_argument("--test-size", type=float, default=0.15, help="Test split ratio.")
    parser.add_argument("--patience", type=int, default=8, help="Early-stopping patience on val F1.")
    parser.add_argument("--num-workers", type=int, default=0, help="DataLoader workers.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed.")
    return parser.parse_args()


if __name__ == "__main__":
    train(parse_args())
