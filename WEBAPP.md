# Parkinson Prediction Web App

## Run
```bash
python3 app.py
```

Open:
`http://127.0.0.1:5000`

## Features
- Drag-and-drop image upload
- Live preview
- Parkinson vs Healthy confidence scores
- Animated probability bars
- Model metadata display (checkpoint, device, image size, best epoch)

## API
Endpoint: `POST /predict`

Form-data:
- `file`: image (`.png`, `.jpg`, `.jpeg`, `.bmp`, `.webp`)

Example curl:
```bash
curl -X POST -F "file=@Train/Parkinson/Parkinson1.png" http://127.0.0.1:5000/predict
```

## Note
For machine-learning experimentation only, not for real clinical diagnosis.
