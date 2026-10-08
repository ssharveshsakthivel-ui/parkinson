#!/usr/bin/env python3
"""
Fine-tune EfficientNet-B0 (from timm) on the Parkinson's spiral drawing dataset.
Produces a production-ready model with proper calibration for both scanned
paper drawings AND digital drawing pad input.
"""
import json
import os
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from PIL import Image
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score, confusion_matrix

# ── Try to import timm; install if missing ────────────────────────────────────
try:
    import timm
except ImportError:
    print("Installing timm…")
    os.system("pip install timm")
    import timm

# ── Config ────────────────────────────────────────────────────────────────────
SEED = 42
DATA_DIR = Path(__file__).resolve().parent / "Train"
OUTPUT_DIR = Path(__file__).resolve().parent / "artifacts_efficientnet"
IMAGE_SIZE = 224
BATCH_SIZE = 32
EPOCHS = 20
LR = 1e-4
WEIGHT_DECAY = 1e-4
VAL_SPLIT = 0.15
TEST_SPLIT = 0.15
PATIENCE = 6
DEVICE = torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
OUTPUT_DIR.mkdir(exist_ok=True)


# ── Dataset ───────────────────────────────────────────────────────────────────
class DrawingDataset(Dataset):
    def __init__(self, paths, labels, transform=None):
        self.paths = paths
        self.labels = labels
        self.transform = transform

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img = Image.open(self.paths[idx]).convert("RGB")
        if self.transform:
            img = self.transform(img)
        return img, self.labels[idx]


def collect_data():
    """Gather image paths and labels from Train/Healthy and Train/Parkinson."""
    paths, labels = [], []
    for label_name, label_idx in [("Healthy", 0), ("Parkinson", 1)]:
        folder = DATA_DIR / label_name
        if not folder.exists():
            raise FileNotFoundError(f"Missing folder: {folder}")
        for f in folder.iterdir():
            if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
                paths.append(str(f))
                labels.append(label_idx)
    return paths, labels


# ── Transforms ────────────────────────────────────────────────────────────────
# Heavy augmentation to bridge the gap between scanned paper and digital drawings
train_transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.RandomHorizontalFlip(p=0.5),
    transforms.RandomVerticalFlip(p=0.3),
    transforms.RandomRotation(15),
    transforms.RandomAffine(degrees=0, translate=(0.1, 0.1), scale=(0.85, 1.15)),
    transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.1),
    transforms.GaussianBlur(kernel_size=3, sigma=(0.1, 1.0)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),  # ImageNet stats
])

val_transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── Training ──────────────────────────────────────────────────────────────────
def train():
    print(f"Device: {DEVICE}")
    print(f"Data dir: {DATA_DIR}")

    # Collect data
    all_paths, all_labels = collect_data()
    print(f"Total images: {len(all_paths)}  (Healthy: {all_labels.count(0)}, Parkinson: {all_labels.count(1)})")

    # Split: train / val / test
    train_paths, test_paths, train_labels, test_labels = train_test_split(
        all_paths, all_labels, test_size=TEST_SPLIT, random_state=SEED, stratify=all_labels
    )
    train_paths, val_paths, train_labels, val_labels = train_test_split(
        train_paths, train_labels, test_size=VAL_SPLIT / (1 - TEST_SPLIT), random_state=SEED, stratify=train_labels
    )

    print(f"Train: {len(train_paths)}, Val: {len(val_paths)}, Test: {len(test_paths)}")

    # Datasets & Loaders
    train_ds = DrawingDataset(train_paths, train_labels, train_transform)
    val_ds = DrawingDataset(val_paths, val_labels, val_transform)
    test_ds = DrawingDataset(test_paths, test_labels, val_transform)

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, num_workers=0, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    # ── Build Model ───────────────────────────────────────────────────────────
    model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=2)
    model = model.to(DEVICE)

    # Freeze early layers, only train the classifier + last few blocks
    for param in model.parameters():
        param.requires_grad = False
    # Unfreeze classifier
    for param in model.classifier.parameters():
        param.requires_grad = True
    # Unfreeze last 2 blocks of the feature extractor
    for name, param in model.named_parameters():
        if "blocks.6" in name or "blocks.5" in name or "conv_head" in name or "bn2" in name:
            param.requires_grad = True

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Model: EfficientNet-B0  |  Trainable: {trainable:,} / {total:,} params")

    # Loss, optimizer, scheduler
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=LR, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS, eta_min=1e-6)

    # ── Training Loop ─────────────────────────────────────────────────────────
    best_val_f1 = 0.0
    patience_counter = 0
    history = []

    for epoch in range(1, EPOCHS + 1):
        # Train
        model.train()
        running_loss = 0.0
        for images, labels in train_loader:
            images, labels = images.to(DEVICE), torch.tensor(labels, dtype=torch.long).to(DEVICE)
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item()

        train_loss = running_loss / len(train_loader)

        # Validate
        model.eval()
        val_preds, val_true, val_probs_list = [], [], []
        val_loss = 0.0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels_t = images.to(DEVICE), torch.tensor(labels, dtype=torch.long).to(DEVICE)
                outputs = model(images)
                val_loss += criterion(outputs, labels_t).item()
                probs = torch.softmax(outputs, dim=1).cpu().numpy()
                val_probs_list.extend(probs[:, 1].tolist())
                val_preds.extend(torch.argmax(outputs, dim=1).cpu().tolist())
                val_true.extend(labels)

        val_loss /= len(val_loader)
        val_acc = accuracy_score(val_true, val_preds)
        val_f1 = f1_score(val_true, val_preds)
        val_prec = precision_score(val_true, val_preds, zero_division=0)
        val_rec = recall_score(val_true, val_preds)
        val_auc = roc_auc_score(val_true, val_probs_list)

        scheduler.step()

        print(f"Epoch {epoch:2d}/{EPOCHS} | Train Loss: {train_loss:.4f} | Val Loss: {val_loss:.4f} | "
              f"Acc: {val_acc:.4f} | F1: {val_f1:.4f} | AUC: {val_auc:.4f}")

        history.append({
            "epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
            "val_accuracy": val_acc, "val_f1": val_f1, "val_precision": val_prec,
            "val_recall": val_rec, "val_roc_auc": val_auc
        })

        # Early stopping
        if val_f1 > best_val_f1:
            best_val_f1 = val_f1
            patience_counter = 0
            torch.save({
                "model_state_dict": model.state_dict(),
                "model_name": "efficientnet_b0",
                "num_classes": 2,
                "image_size": IMAGE_SIZE,
                "class_mapping": {0: "Healthy", 1: "Parkinson"},
                "normalization": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
                "epoch": epoch,
                "best_val_f1": best_val_f1,
            }, OUTPUT_DIR / "best_model.pt")
            print(f"  ✓ Saved best model (F1: {best_val_f1:.4f})")
        else:
            patience_counter += 1
            if patience_counter >= PATIENCE:
                print(f"  Early stopping at epoch {epoch}")
                break

    # ── Test ───────────────────────────────────────────────────────────────────
    print("\n--- Testing ---")
    checkpoint = torch.load(OUTPUT_DIR / "best_model.pt", map_location=DEVICE, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    test_preds, test_true, test_probs_list = [], [], []
    with torch.no_grad():
        for images, labels in test_loader:
            images = images.to(DEVICE)
            outputs = model(images)
            probs = torch.softmax(outputs, dim=1).cpu().numpy()
            test_probs_list.extend(probs[:, 1].tolist())
            test_preds.extend(torch.argmax(outputs, dim=1).cpu().tolist())
            test_true.extend(labels)

    test_acc = accuracy_score(test_true, test_preds)
    test_f1 = f1_score(test_true, test_preds)
    test_prec = precision_score(test_true, test_preds, zero_division=0)
    test_rec = recall_score(test_true, test_preds)
    test_auc = roc_auc_score(test_true, test_probs_list)
    cm = confusion_matrix(test_true, test_preds).tolist()

    print(f"Test Accuracy:  {test_acc:.4f}")
    print(f"Test F1:        {test_f1:.4f}")
    print(f"Test Precision: {test_prec:.4f}")
    print(f"Test Recall:    {test_rec:.4f}")
    print(f"Test AUC-ROC:   {test_auc:.4f}")
    print(f"Confusion Matrix: {cm}")

    # Save metrics
    metrics = {
        "model": "efficientnet_b0",
        "image_size": IMAGE_SIZE,
        "class_mapping": {"0": "Healthy", "1": "Parkinson"},
        "normalization": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "best_epoch": checkpoint["epoch"],
        "best_val_f1": checkpoint["best_val_f1"],
        "test_metrics": {
            "accuracy": test_acc, "f1": test_f1, "precision": test_prec,
            "recall": test_rec, "roc_auc": test_auc
        },
        "test_confusion_matrix": cm,
        "history": history
    }
    with open(OUTPUT_DIR / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    print(f"\n✅ Model saved to: {OUTPUT_DIR / 'best_model.pt'}")
    print(f"✅ Metrics saved to: {OUTPUT_DIR / 'metrics.json'}")


if __name__ == "__main__":
    train()
