import pymongo
import time
import random
import os
import base64
from pathlib import Path
from datetime import datetime, timedelta
from PIL import Image

# Connect to the local model if possible
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False

MONGODB_URI = "mongodb://chakib:chakib@ac-kszhpu2-shard-00-00.hv0v4xt.mongodb.net:27017,ac-kszhpu2-shard-00-01.hv0v4xt.mongodb.net:27017,ac-kszhpu2-shard-00-02.hv0v4xt.mongodb.net:27017/inspection_hub?ssl=true&replicaSet=atlas-clzeil-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
CLASS_NAMES = {0: "crack", 1: "volumetric", 2: "union", 3: "surface"}

def seed_database():
    print("[Seeder] Connecting to MongoDB...")
    client = pymongo.MongoClient(MONGODB_URI)
    db = client.inspection_hub
    
    # 1. Clear old seeded data
    db.inspections.delete_many({"seeded": True})
    print("[Seeder] Cleaned up previous seeded test runs.")

    # 2. Recursively find all PNG/JPG images in data\Welds
    weld_dir = r"E:\FINALE PROJECT\data\Welds\Welds"
    if not os.path.exists(weld_dir):
        print(f"[Seeder] ❌ Error: Weld directory not found at: {weld_dir}")
        return

    print(f"[Seeder] Scanning for real RT weld scans in {weld_dir}...")
    all_images = []
    for root, dirs, files in os.walk(weld_dir):
        for f in files:
            if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                all_images.append(os.path.join(root, f))

    if not all_images:
        print("[Seeder] ❌ Error: No weld scan images found!")
        return

    print(f"[Seeder] Found {len(all_images)} RT images in dataset directory.")
    
    # Shuffle and select exactly 30 images to keep database clean and light
    random.shuffle(all_images)
    selected_images = all_images[:30]
    print(f"[Seeder] Selected 30 random RT images for database seeding.")

    # 3. Load YOLOv8 local model
    model = None
    if HAS_YOLO:
        model_path = Path(__file__).parent / "4_classe.pt"
        if model_path.exists():
            try:
                print(f"[Seeder] Loading YOLOv8 model from {model_path}...")
                model = YOLO(str(model_path))
                print("[Seeder] ✅ YOLOv8 model loaded successfully.")
            except Exception as e:
                print(f"[Seeder] ⚠️ Failed to load YOLOv8 model: {e}")
        else:
            print(f"[Seeder] ⚠️ YOLOv8 model file not found at: {model_path}")
    else:
        print("[Seeder] ⚠️ YOLOv8 package not available.")

    # 4. Projects template
    projects = [
        {"project_name": "Sonatrach Pipeline A", "client_name": "Sonatrach", "standard": "EN 1435", "material": "Carbon Steel", "thickness_mm": 12.5},
        {"project_name": "Arzew Refinery Joint-3", "client_name": "Sonatrach", "standard": "ASME V", "material": "Stainless Steel", "thickness_mm": 10.0},
        {"project_name": "Oran Gas Seam H", "client_name": "Alnaft", "standard": "ISO 17636", "material": "Alloy Steel", "thickness_mm": 15.0},
        {"project_name": "Skikda Port T-9", "client_name": "SARL Gaz", "standard": "API 1104", "material": "Carbon Steel", "thickness_mm": 8.0}
    ]

    inspectors = ["younes", "chakib", "admin"]
    seeded_records = []
    base_date = datetime.now() - timedelta(days=30)

    for i, img_path in enumerate(selected_images, 1):
        print(f"[Seeder] Processing image {i}/30: {os.path.basename(img_path)}...")
        
        # A. Read and encode image as base64
        try:
            with open(img_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                # Determine mime type
                mime = "image/png" if img_path.lower().endswith(".png") else "image/jpeg"
                base64_image = f"data:{mime};base64,{encoded_string}"
        except Exception as e:
            print(f"[Seeder] ❌ Failed to read {img_path}: {e}")
            continue

        # B. Run actual model inference if model is loaded
        detections = []
        if model:
            try:
                results = model(img_path, imgsz=1280, conf=0.25, verbose=False)
                for result in results:
                    boxes = result.boxes
                    if boxes is None:
                        continue
                    for box in boxes:
                        cls_id = int(box.cls[0].item())
                        conf   = float(box.conf[0].item())
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        label  = CLASS_NAMES.get(cls_id, f"class_{cls_id}")
                        
                        # Add bounding box detection
                        detections.append({
                            "type": "box",
                            "label": label,
                            "confidence": conf,
                            "xyxy": [x1, y1, x2, y2]
                        })
                        
                        # Add polygon mask (4 points slightly offset)
                        detections.append({
                            "type": "mask",
                            "label": label,
                            "confidence": conf,
                            "points": [
                                [x1, y1],
                                [x2, y1],
                                [x2, y2],
                                [x1, y2]
                            ]
                        })
                print(f"  -> Model found {len(detections)//2} defects.")
            except Exception as e:
                print(f"  -> ⚠️ Inference error on {img_path}: {e}")

        # If no model or no detections, let's keep some percentage clean,
        # but also generate some realistic defects if model is missing to ensure database variety
        if not model and random.random() < 0.70:
            num_defects = random.randint(1, 3)
            for _ in range(num_defects):
                label = random.choice(list(CLASS_NAMES.values()))
                confidence = random.uniform(0.65, 0.95)
                w = random.randint(50, 150)
                h = random.randint(40, 120)
                x1 = random.randint(100, 500)
                y1 = random.randint(100, 400)
                detections.append({
                    "type": "box",
                    "label": label,
                    "confidence": confidence,
                    "xyxy": [x1, y1, x1+w, y1+h]
                })
                detections.append({
                    "type": "mask",
                    "label": label,
                    "confidence": confidence,
                    "points": [
                        [x1, y1],
                        [x1+w, y1],
                        [x1+w, y1+h],
                        [x1, y1+h]
                    ]
                })

        # C. Decide audit verdict logically
        has_defects = len(detections) > 0
        if not has_defects:
            decision = "Accepted"
        else:
            decision = "Refused"

        # D. Metadata & timestamps
        record_date = base_date + timedelta(days=i - 1) + timedelta(hours=random.randint(1, 8))
        timestamp_str = record_date.strftime("%m/%d/%Y, %I:%M:%S %p")
        record_id = int(record_date.timestamp() * 1000)
        proj = random.choice(projects)

        record = {
            "id": record_id,
            "timestamp": timestamp_str,
            "image": base64_image,
            "detections": detections,
            "username": random.choice(inspectors),
            "decision": decision,
            "model_used": "WeldSight-4CLS",
            "project_name": proj["project_name"],
            "client_name": proj["client_name"],
            "weld_id": f"W-VT-2026-{i:03d}" if "Welds" in img_path else f"W-RT-2026-{i:03d}",
            "thickness_mm": float(proj["thickness_mm"] + random.choice([-1.5, 0.0, 1.5, 2.5])),
            "standard": proj["standard"],
            "material": proj["material"],
            "seeded": True
        }
        seeded_records.append(record)

    # 5. Insert records into MongoDB
    if seeded_records:
        print(f"[Seeder] Inserting {len(seeded_records)} inspection records into MongoDB...")
        db.inspections.insert_many(seeded_records)
        print("[Seeder] Database seeding completed successfully! ✅")
    else:
        print("[Seeder] ❌ Error: No records generated.")

if __name__ == "__main__":
    seed_database()
