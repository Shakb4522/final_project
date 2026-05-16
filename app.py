import gradio as gr
from ultralytics import YOLO
from huggingface_hub import hf_hub_download
from PIL import Image
import cv2
import numpy as np

# =============================================================
# 1. Load BOTH models from Hugging Face Hub
# =============================================================

# Visual inspection model (color photographs of welds)
visual_model_path = hf_hub_download(
    repo_id="chakib2f2sdf/my-yolo-detector",
    filename="best.pt"
)
visual_model = YOLO(visual_model_path)

# Radiographic inspection model (X-ray / RT images of welds)
radio_model_path = hf_hub_download(
    repo_id="chakib2f2sdf/Radio_model",
    filename="best.pt"
)
radio_model = YOLO(radio_model_path)


# =============================================================
# 2. Auto-detect image type: Radiographic vs Visual
# =============================================================
def classify_image_type(pil_image: Image.Image) -> str:
    """
    Determines whether an image is a radiographic (X-ray) or visual (photo).
    
    Radiographic images are nearly always grayscale with very low color
    saturation. Visual weld photos are full-color RGB.
    
    Returns: "radio" or "visual"
    """
    img = pil_image.convert("RGB")
    arr = np.array(img, dtype=np.float32)

    # ---- Check 1: Color saturation ----
    # For each pixel compute max(R,G,B) - min(R,G,B) = chroma
    # Radiographs have chroma ≈ 0 everywhere; color photos have high chroma
    pixel_chroma = arr.max(axis=2) - arr.min(axis=2)          # shape (H, W)
    mean_chroma = pixel_chroma.mean()

    # ---- Check 2: Fraction of near-gray pixels ----
    # A pixel is "gray" if its chroma < 15 (out of 255)
    gray_fraction = (pixel_chroma < 15).mean()

    # Decision: if >92% of pixels are gray AND mean chroma is low → radiograph
    if gray_fraction > 0.92 and mean_chroma < 20:
        return "radio"
    return "visual"


# =============================================================
# 3. Image Preprocessing (CLAHE & Denoising) for Radiography
# =============================================================
def preprocess_radio_image(pil_image: Image.Image) -> Image.Image:
    """
    Applies CLAHE (Contrast Limited Adaptive Histogram Equalization) 
    and denoising to enhance X-ray features.
    """
    # Convert to OpenCV format (grayscale for radiography)
    img_array = np.array(pil_image.convert("L"))
    
    # 1. Denoising (Non-local Means Denoising)
    # Reduces graininess while preserving edges
    denoised = cv2.fastNlMeansDenoising(img_array, None, h=10, templateWindowSize=7, searchWindowSize=21)
    
    # 2. CLAHE (Contrast Enhancement)
    # Improves local contrast to make small cracks/porosity pop
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)
    
    # Convert back to PIL RGB (YOLO expects 3 channels)
    result = Image.fromarray(enhanced).convert("RGB")
    return result


# =============================================================
# 3. Prediction function
# =============================================================
def predict(image, mode, model_choice):
    """
    Parameters
    ----------
    image : PIL.Image
    mode  : str   – "box", "seg", or "both"
    model_choice : str – "Auto-Detect", "Visual (Photo)", or "Radiographic (X-Ray)"
    """

    # --- Pick the right model ---
    if model_choice == "Auto-Detect":
        detected_type = classify_image_type(image)
    elif model_choice == "Visual (Photo)":
        detected_type = "visual"
    else:
        detected_type = "radio"

    model = radio_model if detected_type == "radio" else visual_model
    model_label = "Radiographic (X-Ray)" if detected_type == "radio" else "Visual (Photo)"

    # --- Preprocess if it is a radiograph ---
    analysis_image = image
    if detected_type == "radio":
        analysis_image = preprocess_radio_image(image)
    
    # --- Run prediction ---
    task = "segment" if mode in ["seg", "both"] else "detect"
    results = model.predict(source=analysis_image, task=task, save=False)
    r = results[0]

    # --- Annotated image ---
    if mode == "seg":
        annotated = r.plot(boxes=False)
    elif mode == "box":
        annotated = r.plot(masks=False)
    else:
        annotated = r.plot()

    # --- Extract structured detections ---
    detections = []

    if r.boxes is not None:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            detections.append({
                "type": "box",
                "label": r.names[cls_id],
                "confidence": round(float(box.conf[0]), 4),
                "xyxy": box.xyxy[0].tolist()
            })

    if hasattr(r, "masks") and r.masks is not None:
        for i in range(len(r.masks)):
            cls_id = int(r.boxes.cls[i])
            points = r.masks.xy[i].tolist() if len(r.masks.xy) > i else []
            detections.append({
                "type": "mask",
                "label": r.names[cls_id],
                "confidence": round(float(r.boxes.conf[i]), 4),
                "points": points
            })

    # --- Summary banner ---
    summary = {
        "model_used": model_label,
        "total_detections": len([d for d in detections if d["type"] == "box"]),
        "detections": detections
    }

    return annotated, summary


# =============================================================
# 4. Gradio UI
# =============================================================
with gr.Blocks(
    title="WeldSight AI – Dual-Model Weld Defect Detector",
    theme=gr.themes.Soft()
) as demo:

    gr.Markdown(
        """
        # 🔬 WeldSight AI – Weld Defect Detector
        Upload an image and the system will **automatically detect** whether it is a 
        **visual photograph** or a **radiographic (X-ray)** image, then run the 
        appropriate YOLO model for defect detection.
        
        You can also manually override the model selection below.
        """
    )

    with gr.Row():
        with gr.Column(scale=1):
            img_input = gr.Image(type="pil", label="Upload Weld Image")
            mode_input = gr.Radio(
                ["box", "seg", "both"],
                value="both",
                label="Detection Mode"
            )
            model_input = gr.Radio(
                ["Auto-Detect", "Visual (Photo)", "Radiographic (X-Ray)"],
                value="Auto-Detect",
                label="Model Selection"
            )
            run_btn = gr.Button("🔍 Analyze", variant="primary", size="lg")

        with gr.Column(scale=1):
            img_output = gr.Image(type="numpy", label="Detection Result")
            json_output = gr.JSON(label="Detection Details")

    run_btn.click(
        fn=predict,
        inputs=[img_input, mode_input, model_input],
        outputs=[img_output, json_output],
        api_name="predict"
    )

    gr.Markdown(
        """
        ---
        **Models:**  
        🟢 **Visual** → `chakib2f2sdf/my-yolo-detector`  
        🔵 **Radiographic** → `chakib2f2sdf/Radio_model`  
        
        *Auto-Detect classifies the image by color saturation — grayscale images 
        are routed to the radiographic model, color photos to the visual model.*
        """
    )

demo.launch()
