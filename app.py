#!/usr/bin/env python3
from __future__ import annotations

import io
import json
from pathlib import Path

from functools import wraps
import os
os.environ["HF_HOME"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")

import numpy as np
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, ImageFilter, ImageOps
from supabase import create_client, Client


from train_parkinson_advanced import CustomParkinsonCNN, pil_to_tensor, Resize

# ──────────────────────────────────────────────────────────────────────────────
# Calibrated confidence threshold.
# The model was trained with recall=1.0 (never miss Parkinson), which makes it
# biased toward Parkinson for borderline cases. Raising the threshold to 0.65
# reduces false positives while keeping clinically meaningful detections.
# ──────────────────────────────────────────────────────────────────────────────
PARKINSON_CONFIDENCE_THRESHOLD = 0.99   # must be ≥ this to call it Parkinson
BORDERLINE_LOWER_THRESHOLD    = 0.85   # 0.85–0.99 → "Borderline"


def preprocess_for_inference(image: Image.Image) -> Image.Image:
    """Transform a digital canvas drawing into something that looks like a
    scanned pencil-on-paper drawing — matching the training data distribution.

    Training images have:
      - Light grey background (~230-240, NOT pure 255 white)
      - Thin pencil strokes in mid-grey (~100-160, NOT pure 0 black)
      - Visible paper grain / texture noise
      - Slightly soft edges from scanner optics
    """
    # 1. Ensure RGB
    if image.mode == "RGBA":
        bg = Image.new("RGB", image.size, (255, 255, 255))
        bg.paste(image, mask=image.split()[3])
        image = bg
    else:
        image = image.convert("RGB")

    arr = np.array(image, dtype=np.float32)

    # 2. Compress dynamic range to match scanned paper:
    #    Pure white (255) → paper grey (~235)
    #    Pure black (0)   → pencil grey (~100)
    #    This maps [0, 255] → [100, 235]
    arr = 100.0 + (arr / 255.0) * 135.0

    # Removed artificial noise which was causing false positive "tremors"
    
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    image = Image.fromarray(arr)

    # 4. Tremor Emphasis: Highlight jagged strokes, vibrations, and micro-tremors
    # This precisely matches the TremorEmphasis transform added to the CNN training
    image = image.filter(ImageFilter.UnsharpMask(radius=2.0, percent=150, threshold=3))
    image = image.filter(ImageFilter.EDGE_ENHANCE_MORE)

    return image


BASE_DIR = Path(__file__).resolve().parent
# ── Checkpoint priority: EfficientNet first, then custom CNN ──────────────────
DEFAULT_CHECKPOINTS = [
    BASE_DIR / "artifacts_efficientnet" / "best_model.pt",   # NEW: fine-tuned EfficientNet-B0
    BASE_DIR / "artifacts_custom" / "best_model.pt",
    BASE_DIR / "artifacts_quick" / "best_model.pt",
    BASE_DIR / "artifacts_v2" / "best_model.pt",
    BASE_DIR / "artifacts" / "best_model.pt",
]
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}

# ── Try to import timm for EfficientNet ───────────────────────────────────────
try:
    import timm
    HAS_TIMM = True
except ImportError:
    HAS_TIMM = False


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def choose_checkpoint() -> Path:
    for path in DEFAULT_CHECKPOINTS:
        if path.exists():
            return path
    raise FileNotFoundError("No checkpoint found. Train model first.")


def normalize_idx_to_class(raw: dict) -> dict[int, str]:
    return {int(k): str(v) for k, v in raw.items()}


class Predictor:
    """Unified predictor that auto-detects whether the checkpoint is
    EfficientNet (timm) or CustomParkinsonCNN and loads accordingly."""

    def __init__(self, checkpoint_path: Path) -> None:
        self.checkpoint_path = checkpoint_path
        self.device = get_device()
        checkpoint = torch.load(checkpoint_path, map_location=self.device, weights_only=False)

        # Detect model type from checkpoint keys
        self.model_name = checkpoint.get("model_name", "custom_cnn")
        is_efficientnet = "efficientnet" in self.model_name.lower()

        # Class mapping
        if "class_mapping" in checkpoint:
            self.idx_to_class = normalize_idx_to_class(checkpoint["class_mapping"])
        elif "idx_to_class" in checkpoint:
            self.idx_to_class = normalize_idx_to_class(checkpoint["idx_to_class"])
        else:
            self.idx_to_class = {0: "Healthy", 1: "Parkinson"}

        self.image_size = int(checkpoint.get("image_size", 224))

        # Normalization stats
        norm = checkpoint.get("normalization", {})
        if norm:
            mean_vals = norm["mean"]
            std_vals = norm["std"]
        elif "mean" in checkpoint:
            mean_vals = checkpoint["mean"]
            std_vals = checkpoint["std"]
        else:
            # ImageNet defaults
            mean_vals = [0.485, 0.456, 0.406]
            std_vals = [0.229, 0.224, 0.225]

        self.mean = torch.tensor(mean_vals, dtype=torch.float32).view(3, 1, 1).to(self.device)
        self.std = torch.tensor(std_vals, dtype=torch.float32).view(3, 1, 1).to(self.device)

        # Build model
        num_classes = checkpoint.get("num_classes", len(self.idx_to_class))

        if is_efficientnet and HAS_TIMM:
            print(f"[✓] Loading EfficientNet model: {self.model_name}")
            self.model = timm.create_model(self.model_name, pretrained=False, num_classes=num_classes)
        else:
            print(f"[✓] Loading Custom CNN model")
            self.model = CustomParkinsonCNN(num_classes=num_classes)

        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model = self.model.to(self.device)
        self.model.eval()
        self.best_epoch = int(checkpoint.get("epoch", -1))
        print(f"    Checkpoint: {checkpoint_path.name}  |  Classes: {self.idx_to_class}  |  Epoch: {self.best_epoch}")

    def predict(self, image_bytes: bytes, is_drawing: bool = False) -> dict:
        with Image.open(io.BytesIO(image_bytes)) as img:
            image = img.convert("RGB")

        # Apply preprocessing to digital drawings to reduce distribution mismatch
        if is_drawing:
            image = preprocess_for_inference(image)

        image = Resize(self.image_size)(image)
        tensor = pil_to_tensor(image).to(self.device)
        tensor = (tensor - self.mean) / self.std
        tensor = tensor.unsqueeze(0)

        with torch.no_grad():
            logits = self.model(tensor)
            probs_tensor = torch.softmax(logits, dim=1).squeeze(0).detach().cpu()

        probs = probs_tensor.tolist()

        # ── Calibrated classification ─────────────────────────────────────────
        # Find Parkinson class index
        parkinson_idx = next(
            (i for i, name in self.idx_to_class.items() if name.lower() == "parkinson"),
            None
        )
        healthy_idx = next(
            (i for i, name in self.idx_to_class.items() if name.lower() == "healthy"),
            None
        )

        parkinson_prob = float(probs[parkinson_idx]) if parkinson_idx is not None else 0.0
        healthy_prob   = float(probs[healthy_idx])   if healthy_idx   is not None else 1.0

        # Apply threshold: require ≥65% confidence to call it Parkinson
        if parkinson_prob >= PARKINSON_CONFIDENCE_THRESHOLD:
            pred_idx  = parkinson_idx
            pred_name = "Parkinson"
            confidence = parkinson_prob
        elif parkinson_prob >= BORDERLINE_LOWER_THRESHOLD:
            # Ambiguous zone — do not call it Parkinson
            pred_idx  = parkinson_idx   # closest class for indexing
            pred_name = "Borderline"
            confidence = parkinson_prob
        else:
            pred_idx  = healthy_idx if healthy_idx is not None else 0
            pred_name = "Healthy"
            confidence = healthy_prob

        class_probabilities = {self.idx_to_class[i]: float(probs[i]) for i in range(len(probs))}

        print(f"--- Inference ---")
        print(f"  Is Drawing: {is_drawing}")
        print(f"  Raw Prob:   H={healthy_prob:.4f}  P={parkinson_prob:.4f}")
        print(f"  Result:     {pred_name} (Threshold used: {PARKINSON_CONFIDENCE_THRESHOLD})")

        return {
            "predicted_class": pred_name,
            "predicted_index": pred_idx,
            "confidence": confidence,
            "class_probabilities": class_probabilities,
            "raw_parkinson_prob": parkinson_prob,
            "threshold_used": PARKINSON_CONFIDENCE_THRESHOLD,
        }


checkpoint_path = choose_checkpoint()
predictor = Predictor(checkpoint_path=checkpoint_path)
app = Flask(__name__)
DEV_ALLOWED_ORIGINS = [
    r"http://localhost:\d+",
    r"http://127\.0\.0\.1:\d+",
    r"http://\d{1,3}(?:\.\d{1,3}){3}:\d+",
    r"http://10\.\d+\.\d+\.\d+:\d+",
    r"http://192\.168\.\d+\.\d+:\d+",
    r"http://172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+:\d+",
]
CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": DEV_ALLOWED_ORIGINS}})
app.secret_key = "neurotrace_super_secret_key"

import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "https://rglnzkvkubmdkzydosdb.supabase.co")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnbG56a3ZrdWJtZGt6eWRvc2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjAzMjUsImV4cCI6MjA4ODAzNjMyNX0.b2hd5vbdbcwbOXvAiF6r_41bpy8J8othe-asHJOjHg8")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_authed_db_client(token: str) -> Client:
    db_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    db_client.postgrest.auth(token)
    return db_client

def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            auth_header = request.headers.get("Authorization")
            if not auth_header or not auth_header.startswith("Bearer "):
                return jsonify({"error": "Unauthorized: Missing Bearer token"}), 401
                
            token = auth_header.split(" ")[1]
            try:
                # Handle compatibility across different supabase-py versions (v1 vs v2)
                user_res = None
                if hasattr(supabase.auth, "get_user"):
                    user_res = supabase.auth.get_user(token)
                elif hasattr(supabase.auth, "api") and hasattr(supabase.auth.api, "get_user"):
                    user_res = supabase.auth.api.get_user(token)

                if not user_res:
                    return jsonify({"error": "Unauthorized: Invalid token"}), 401
                    
                # In v1, get_user returns the user object directly. In v2 it returns a response object with .user
                active_user = getattr(user_res, "user", user_res)
                if not active_user:
                    return jsonify({"error": "Unauthorized: Invalid token (no user)"}), 401

                # Prefer role from profiles table; metadata can be stale or absent.
                user_role = None
                try:
                    db_client = get_authed_db_client(token)
                    role_res = (
                        db_client.table("profiles")
                        .select("role")
                        .eq("id", active_user.id)
                        .maybe_single()
                        .execute()
                    )
                    if role_res and role_res.data:
                        user_role = role_res.data.get("role")
                except Exception:
                    # Fallback to metadata role if profile lookup fails.
                    user_role = None

                if not user_role:
                    user_role = active_user.user_metadata.get("role")

                if user_role not in roles:
                    return jsonify({"error": f"Forbidden: Requires one of {roles} roles"}), 403
                    
                request.user = active_user
                request.user_role = user_role
                request.auth_token = token
            except Exception as e:
                return jsonify({"error": f"Authentication failed: {str(e)}"}), 401
                
            return f(*args, **kwargs)
        return decorated_function
    return decorator


@app.route("/api/health", methods=["GET"])
def health() -> str:
    return jsonify({"status": "healthy"})
@app.route("/api/predict", methods=["POST"])
@role_required('doctor', 'patient')
def predict_api():
    if "file" not in request.files:
        return jsonify({"error": "No file provided. Use form-data with key 'file'."}), 400

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "":
        return jsonify({"error": "File name is empty."}), 400

    ext = Path(uploaded_file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Unsupported file type: {ext}. Use PNG/JPG/JPEG/BMP/WEBP."}), 400

    # drawing=true means the image came from the digital DrawingPad,
    # not a scanned file — apply extra preprocessing.
    is_drawing = request.form.get("drawing", "false").lower() == "true"

    try:
        result = predictor.predict(uploaded_file.read(), is_drawing=is_drawing)
        
        # Calculate Severity derived from calibrated prediction
        pred_class = result["predicted_class"]
        conf = result["confidence"]
        raw_pk_prob = result.get("raw_parkinson_prob", conf)

        avg_pressure_str = request.form.get("avg_pressure")
        if is_drawing and avg_pressure_str:
            try:
                avg_pressure = float(avg_pressure_str)
                # Normal pressure is between 300 and 700.
                if avg_pressure < 300:
                    pred_class = "Parkinson"
                    result["reason"] = "Abnormally low pressure (potential weakness or hesitation)"
                    result["average_pressure"] = round(avg_pressure)
                    conf = max(conf, 0.85)
                elif avg_pressure > 700:
                    pred_class = "Parkinson"
                    result["reason"] = "Abnormally high pressure (potential muscle rigidity)"
                    result["average_pressure"] = round(avg_pressure)
                    conf = max(conf, 0.85)
                else:
                    result["reason"] = "Normal pressure range"
                    result["average_pressure"] = round(avg_pressure)
            except ValueError:
                pass
        
        result["predicted_class"] = pred_class
        result["confidence"] = conf

        severity_level = "None"
        if pred_class.lower() == "parkinson":
            # Higher severity only when raw Parkinson probability is very high
            severity_level = "Higher Level" if raw_pk_prob >= 0.85 else "Lower Level"
        elif pred_class.lower() == "borderline":
            severity_level = "Borderline"
            
        result["severity_level"] = severity_level
        
        # Optional: Log report to Supabase for both doctor-driven and patient self-analysis flows
        patient_id = request.form.get("patient_id")
        auth_user = getattr(request, "user", None)
        user_role = getattr(request, "user_role", None)
        auth_token = getattr(request, "auth_token", None)

        doctor_id = None
        if auth_user:
            if user_role == "patient":
                # Patient self-analysis should be tied to their own profile
                patient_id = auth_user.id
            elif user_role == "doctor":
                doctor_id = auth_user.id
        
        report_id = None
        if patient_id:
            suggestion_text = (
                "Awaiting formal review."
                if doctor_id
                else "Self-analysis generated by patient. Awaiting doctor review."
            )

            if auth_token:
                try:
                    db_client = get_authed_db_client(auth_token)
                    db_res = db_client.table("predictions_and_reports").insert({
                        "patient_id": patient_id,
                        "doctor_id": doctor_id,
                        "prediction_result": pred_class,
                        "severity_level": severity_level,
                        "confidence_score": conf,
                        "doctor_suggestions": suggestion_text
                    }).execute()

                    if db_res.data and len(db_res.data) > 0:
                        report_id = db_res.data[0].get("report_id")
                except Exception as db_exc:
                    # Do not fail inference when report persistence fails.
                    print(f"[WARN] Failed to persist prediction report: {db_exc}")
                
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {exc}"}), 500

    return jsonify(
        {
            "result": result,
            "report_id": report_id,
            "model": {
                "checkpoint": str(checkpoint_path.relative_to(BASE_DIR)),
                "image_size": predictor.image_size,
                "device": str(predictor.device),
                "best_epoch": predictor.best_epoch,
            },
            "disclaimer": "For ML research/demo only. This is not a medical diagnosis tool.",
        }
    )

@app.route("/api/predict-fsr", methods=["POST"])
def predict_fsr_api():
    """
    Endpoint for FSR (Force Sensitive Resistor) hardware integration.
    Detects Parkinson's based on abnormal pressure applied by the user.
    """
    data = request.get_json()
    if not data or "average_pressure" not in data:
        return jsonify({"error": "Missing 'average_pressure' in JSON payload"}), 400
        
    avg_pressure = float(data["average_pressure"])
    
    # Heuristic for FSR data (assuming 0-1023 analog range from an Arduino ADC)
    # Normal pressure is between 300 and 700.
    # Less than 300 indicates weakness/hesitation, greater than 700 indicates rigidity.
    if avg_pressure < 300:
        pred_class = "Parkinson"
        reason = "Abnormally low pressure (potential weakness or hesitation)"
        severity_level = "Higher Level" if avg_pressure < 150 else "Lower Level"
        confidence = 0.85
    elif avg_pressure > 700:
        pred_class = "Parkinson"
        reason = "Abnormally high pressure (potential muscle rigidity)"
        severity_level = "Higher Level" if avg_pressure > 850 else "Lower Level"
        confidence = 0.85
    else:
        pred_class = "Healthy"
        reason = "Normal pressure range"
        severity_level = "None"
        confidence = 0.90
        
    result = {
        "predicted_class": pred_class,
        "reason": reason,
        "average_pressure": avg_pressure,
        "severity_level": severity_level,
        "confidence": confidence,
        "sensor_type": "FSR"
    }
    
    # Optional DB storage logic similar to image prediction could be added here
    patient_id = data.get("patient_id")
    report_id = None
    
    if patient_id:
        auth_token = request.headers.get("Authorization", "").replace("Bearer ", "")
        if auth_token:
            try:
                db_client = get_authed_db_client(auth_token)
                db_res = db_client.table("predictions_and_reports").insert({
                    "patient_id": patient_id,
                    "prediction_result": pred_class,
                    "severity_level": severity_level,
                    "confidence_score": confidence,
                    "doctor_suggestions": f"FSR Sensor: {reason}"
                }).execute()
                
                if db_res.data and len(db_res.data) > 0:
                    report_id = db_res.data[0].get("report_id")
            except Exception as db_exc:
                print(f"[WARN] Failed to persist FSR prediction report: {db_exc}")

    return jsonify({
        "result": result,
        "report_id": report_id,
        "disclaimer": "Hardware prototype FSR reading. Not a clinical diagnosis."
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8088, debug=False)
