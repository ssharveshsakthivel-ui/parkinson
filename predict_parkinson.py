#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from PIL import Image

import os
os.environ["HF_HOME"] = "/Users/sharvesh/Downloads/parkinson/.cache"
from train_parkinson_advanced import CustomParkinsonCNN, get_device, pil_to_tensor, Resize

project_dir = Path(__file__).resolve().parent

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict Parkinson/Healthy class for a single image.")
    parser.add_argument("--image", type=str, required=True, help="Path to image file.")
    parser.add_argument(
        "--checkpoint",
        type=str,
        default=str(project_dir / "artifacts_custom" / "best_model.pt"),
        help="Path to trained checkpoint.",
    )
    parser.add_argument(
        "--width-mult",
        type=float,
        default=1.0,
        help="Fallback width multiplier if checkpoint does not include it.",
    )
    return parser.parse_args()


def to_idx_to_class(raw: dict) -> dict[int, str]:
    out: dict[int, str] = {}
    for k, v in raw.items():
        out[int(k)] = str(v)
    return out


def main() -> None:
    args = parse_args()
    image_path = Path(args.image).resolve()
    ckpt_path = Path(args.checkpoint).resolve()

    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")
    if not ckpt_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {ckpt_path}")

    device = get_device()
    checkpoint = torch.load(ckpt_path, map_location=device)
    idx_to_class = to_idx_to_class(checkpoint["idx_to_class"])
    # width_mult and dropout are not used by CustomParkinsonCNN
    # width_mult = float(checkpoint.get("width_mult", args.width_mult))
    # dropout = float(checkpoint.get("dropout", 0.35))
    image_size = int(checkpoint["image_size"])
    mean = torch.tensor(checkpoint["mean"], dtype=torch.float32).view(3, 1, 1).to(device)
    std = torch.tensor(checkpoint["std"], dtype=torch.float32).view(3, 1, 1).to(device)

    model = CustomParkinsonCNN(num_classes=len(idx_to_class)).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    with Image.open(image_path) as img:
        image = img.convert("RGB")
    image = Resize(image_size)(image)
    tensor = pil_to_tensor(image).to(device)
    tensor = (tensor - mean) / std
    tensor = tensor.unsqueeze(0)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1).squeeze(0).tolist()
    pred_idx = int(torch.argmax(logits, dim=1).item())

    result = {
        "predicted_class": idx_to_class[pred_idx],
        "predicted_index": pred_idx,
        "class_probabilities": {idx_to_class[i]: float(probs[i]) for i in range(len(probs))},
        "image": str(image_path),
        "checkpoint": str(ckpt_path),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
