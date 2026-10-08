# Parkinson Model Training

## What was created
- Training script: `train_parkinson_advanced.py`
- Best trained checkpoint: `artifacts_v2/best_model.pt`
- Full report: `artifacts_v2/metrics.json`

## Current model performance (held-out test split)
- Accuracy: `0.5878`
- Precision: `0.5857`
- Recall: `0.6000`
- F1 Score: `0.5927`
- ROC AUC: `0.6375`

## Retrain command
```bash
PYTHONUNBUFFERED=1 python3 train_parkinson_advanced.py \
  --data-dir Train \
  --output-dir artifacts_v2 \
  --epochs 12 \
  --patience 5 \
  --batch-size 64 \
  --image-size 128 \
  --width-mult 0.75 \
  --num-workers 0
```

## Notes
- Your dataset is balanced: `1632 Healthy` and `1632 Parkinson`.
- If you run outside this restricted environment, you can try `--num-workers 4` for faster loading.
- You can improve quality further by increasing `--epochs` and tuning `--image-size` and `--width-mult`.
- This model is for ML experimentation only, not for real medical diagnosis.

## Predict on one image
```bash
python3 predict_parkinson.py \
  --image Train/Parkinson/Parkinson1.png \
  --checkpoint artifacts_v2/best_model.pt
```
