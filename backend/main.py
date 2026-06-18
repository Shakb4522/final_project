from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List, Optional
import os
import io
import time
import shutil
import tempfile
import base64
from pathlib import Path
from dotenv import load_dotenv
import cv2
import numpy as np
from ultralytics import YOLO
from huggingface_hub import hf_hub_download

load_dotenv()

app = FastAPI(title="WeldSight NDT API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── MongoDB ───────────────────────────────────────────────────────────────────
MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb://chakib:chakib@ac-kszhpu2-shard-00-00.hv0v4xt.mongodb.net:27017,"
    "ac-kszhpu2-shard-00-01.hv0v4xt.mongodb.net:27017,"
    "ac-kszhpu2-shard-00-02.hv0v4xt.mongodb.net:27017/"
    "inspection_hub?ssl=true&replicaSet=atlas-clzeil-shard-0"
    "&authSource=admin&retryWrites=true&w=majority&appName=Cluster0"
)
mongo_client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db = mongo_client.inspection_hub

# Your Hugging Face model repository
HF_MODEL_REPO = "chakib2f2sdf/weldsight-yolo-models"

# In-memory dictionary to hold loaded models
_models = {
    "radio": {"binary": None, "4cls": None, "7cls": None},
    "visual": {"binary": None, "4cls": None, "7cls": None}
}

MODEL_VERSIONS = {
    "4cls": "WeldSight-Space-4CLS (P:84.3% R:75.6% mAP50:78.5%)",
    "binary": "WeldSight-Space-Binary (P:93.0% R:79.7% mAP50:88.0%)",
    "7cls": "WeldSight-Space-7CLS-Elite (P:79.7% R:78.1% mAP50:79.5%)"
}

def download_and_load_model(inspection_type: str, model_type: str) -> YOLO:
    global _models
    
    filenames = {
        "radio": {
            "binary": "RT_binary.pt",
            "4cls": "RT_4classe.pt",
            "7cls": "RT_7classes.pt"
        },
        "visual": {
            "binary": "VT_binary.pt",
            "4cls": "VT_6classes.pt",
            "7cls": "VT_6classes.pt"
        }
    }
    
    filename = filenames[inspection_type][model_type]
    
    if _models[inspection_type][model_type] is None:
        print(f"[Loading] Fetching {filename} from Hub repo: {HF_MODEL_REPO}...")
        try:
            model_path = hf_hub_download(
                repo_id=HF_MODEL_REPO,
                filename=filename,
                token=os.getenv("HF_TOKEN")
            )
            try:
                device = "cuda" if cv2.cuda.getCudaEnabledDeviceCount() > 0 else "cpu"
            except AttributeError:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                
            _models[inspection_type][model_type] = YOLO(model_path).to(device)
            print(f"[Success] Loaded model [{inspection_type} -> {model_type}] to {device}")
        except Exception as e:
            print(f"[Error] Failed to load model {filename}: {e}")
            raise RuntimeError(f"Failed to load model {filename}: {e}")
            
    return _models[inspection_type][model_type]


def classify_image_type(image_path: str) -> str:
    try:
        img = cv2.imread(image_path)
        if img is not None and len(img.shape) == 3:
            b, g, r = cv2.split(img)
            if not (np.allclose(b, g) and np.allclose(g, r)):
                return "visual"
    except Exception as ex:
        print(f"[Classifier] Error: {ex}. Defaulting to radio.")
    return "radio"


def preprocess_radio_image(image_path: str):
    try:
        img_array = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img_array is not None:
            denoised = cv2.fastNlMeansDenoising(img_array, None, h=10, templateWindowSize=7, searchWindowSize=21)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(denoised)
            cv2.imwrite(image_path, enhanced)
    except Exception as e:
        print(f"[Preprocessing] Preprocessing failed: {e}")


@app.on_event("startup")
async def startup():
    # Pre-load models from HF
    print(f"[Startup] Pre-loading models from: {HF_MODEL_REPO}")
    for insp_type in ["radio", "visual"]:
        for model_type in ["binary", "4cls"]:
            try:
                download_and_load_model(insp_type, model_type)
            except Exception as e:
                print(f"[Startup Warn] Pre-loading failed for [{insp_type} -> {model_type}]: {e}")
    # Seed default MongoDB users
    try:
        await mongo_client.admin.command("ping")
        print("[WeldSight] ✅ MongoDB connected")
        for u, pw, role in [
            ("admin", "admin123", "Lead Inspector"),
            ("chakib", "chakib123", "Inspector"),
            ("younes", "younes123", "Inspector"),
        ]:
            if not await db.registered_users.find_one({"username": u}):
                await db.registered_users.insert_one({"username": u, "password": pw, "role": role})
                print(f"[WeldSight] Seeded user: {u}")
    except Exception as e:
        print(f"[WeldSight] ⚠️ MongoDB error: {e}")


# ─── Pydantic Models ───────────────────────────────────────────────────────────

class Message(BaseModel):
    id: Optional[float] = None
    role: str
    content: str

class ChatSession(BaseModel):
    id: float
    title: str
    messages: List[Message]
    username: Optional[str] = "Anonymous"

class UserLogin(BaseModel):
    username: str
    password: str

class UserRegister(BaseModel):
    username: str
    password: str
    role: Optional[str] = "Inspector"

class InspectionRecord(BaseModel):
    id: float
    timestamp: str
    image: Optional[str] = None
    detections: List[dict]
    username: Optional[str] = "Anonymous"
    decision: Optional[str] = None
    model_used: Optional[str] = None


# ─── Helper ────────────────────────────────────────────────────────────────────

async def log_model_usage(request: Request, model_type: str):
    username = request.headers.get("x-user-id", "Anonymous")
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0] if forwarded else request.client.host
    now = time.time()
    action_map = {
        "4cls":  "Used WeldSight-4CLS Local Model",
        "binary": "Used WeldSight-Binary Local Model",
        "7cls": "Used WeldSight-7CLS-Elite Local Model",
    }
    await db.activity.insert_one({
        "ip": ip, "username": username,
        "action": action_map.get(model_type, "Unknown Action"),
        "model_type": model_type, "timestamp": now,
    })
    await db.connections.update_one(
        {"username": username},
        {"$set": {"ip": ip, "username": username, "last_seen": now}},
        upsert=True,
    )


# ─── 🔥 LOCAL MODEL INFERENCE ─────────────────────────────────────────────────

@app.post("/api/analyze")
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    model_type: str = Query("4cls"),
    inspection_type: str = Query("auto")
):
    if model_type not in ["4cls", "binary", "7cls"]:
        model_type = "4cls"

    suffix = Path(file.filename).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        resolved_type = inspection_type
        if resolved_type == "auto":
            resolved_type = classify_image_type(tmp_path)

        # Download and load the model on-demand
        model = download_and_load_model(resolved_type, model_type)

        if resolved_type == "radio":
            preprocess_radio_image(tmp_path)

        with open(tmp_path, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        preprocessed_image_url = f"data:image/jpeg;base64,{b64_data}"

        if model_type == "4cls":
            imgsz = 1280
        elif model_type == "7cls":
            imgsz = 640
        else:
            imgsz = 1024

        try:
            device = "cuda" if cv2.cuda.getCudaEnabledDeviceCount() > 0 else "cpu"
        except AttributeError:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"

        results = model(tmp_path, imgsz=imgsz, conf=0.10, verbose=False, device=device)
        
        detections = []
        class_names = getattr(model, "names", {})

        for result in results:
            boxes = result.boxes
            masks = getattr(result, "masks", None)
            
            if boxes is None:
                continue

            for i, box in enumerate(boxes):
                cls_id = int(box.cls[0].item())
                conf   = float(box.conf[0].item())
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                label  = class_names.get(cls_id, f"class_{cls_id}")

                detections.append({
                    "type":       "box",
                    "label":      label,
                    "confidence": conf,
                    "xyxy":       [x1, y1, x2, y2],
                })

                if masks is not None and i < len(masks.xy):
                    poly = masks.xy[i]
                    if len(poly) >= 3:
                        points = [[float(p[0]), float(p[1])] for p in poly]
                        detections.append({
                            "type":       "mask",
                            "label":      label,
                            "confidence": conf,
                            "points":     points,
                            "xyxy":       [x1, y1, x2, y2],
                        })

        model_version = f"WeldSight-VT-Visual" if resolved_type == "visual" else MODEL_VERSIONS.get(model_type, model_type)

        # Log usage in our DB
        await log_model_usage(request, model_type)

        return {
            "detections": detections,
            "model_used": model_version,
            "preprocessed_image": preprocessed_image_url
        }

    except Exception as e:
        print(f"[Error] Inference failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ─── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
async def login(user: UserLogin, request: Request):
    db_user = await db.registered_users.find_one({"username": user.username})
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found. Contact admin to register.")
    if db_user.get("password") != user.password:
        raise HTTPException(status_code=401, detail="Incorrect password.")
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0] if forwarded else request.client.host
    await db.connections.update_one(
        {"username": user.username},
        {"$set": {"ip": ip, "username": user.username, "last_seen": time.time(), "role": db_user.get("role", "Inspector")}},
        upsert=True,
    )
    return {"status": "success", "username": user.username, "role": db_user.get("role", "Inspector")}


@app.post("/api/register")
async def register(user: UserRegister):
    if await db.registered_users.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="Username already exists.")
    await db.registered_users.insert_one({"username": user.username, "password": user.password, "role": user.role or "Inspector"})
    return {"status": "success", "username": user.username}


# ─── Global Stats / Traffic ────────────────────────────────────────────────────

@app.get("/api/global-stats")
async def get_global_stats():
    return [
        {
            "model_name":  "WeldSight-4CLS-Local",
            "model_key":   "4cls",
            "status":      "OPERATIONAL",
            "uptime":      "99.99%",
            "description": "Local 4-class radiographic defect detector (crack / volumetric / union / surface). P:78.8% R:67.8% mAP50:72.3%",
        },
    ]


@app.get("/api/model-details/{model_key}")
async def get_model_details(model_key: str):
    if model_key not in ["4cls", "yolo", "radio"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    now = time.time()
    five_min_ago = now - 300
    recent = await db.activity.find({"model_type": model_key, "timestamp": {"$gte": five_min_ago}}).sort("timestamp", -1).to_list(1000)
    seen = {}
    for a in recent:
        u = a.get("username", "Anonymous")
        if u not in seen:
            seen[u] = {"username": u, "ip": a.get("ip", "0.0.0.0"), "last_used": time.strftime("%H:%M:%S", time.localtime(a["timestamp"]))}
    recent_logs = await db.activity.find({"model_type": model_key}).sort("timestamp", -1).to_list(5)
    short_logs = [{"username": l.get("username"), "ip": l.get("ip", "0.0.0.0"), "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", now)))} for l in recent_logs]
    return {"active_users": list(seen.values()), "active_count": len(seen), "recent_logs": short_logs}


@app.get("/api/model-logs/{model_key}")
async def get_model_logs(model_key: str):
    if model_key not in ["4cls", "yolo", "radio"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    logs = await db.activity.find({"model_type": model_key}).sort("timestamp", -1).to_list(5000)
    return [{"username": l.get("username"), "ip": l.get("ip", "0.0.0.0"), "action": l.get("action", ""), "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", time.time())))} for l in logs]


@app.post("/api/test-traffic/{model_key}")
async def test_traffic(model_key: str, request: Request):
    if model_key not in ["4cls", "yolo", "radio"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    username = request.headers.get("x-user-id", "Anonymous")
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0] if forwarded else request.client.host
    start = time.time()
    await log_model_usage(request, model_key)
    latency_ms = round((time.time() - start) * 1000, 1)
    servers = {
        "4cls":  {"host": "localhost (WeldSight-4CLS)", "ip": "127.0.0.1", "region": "Local GPU (RTX 4060)"},
        "yolo":  {"host": "localhost",                  "ip": "127.0.0.1", "region": "Local"},
        "radio": {"host": "localhost",                  "ip": "127.0.0.1", "region": "Local"},
    }
    s = servers[model_key]
    return {"status": "success", "client_ip": client_ip, "username": username, "server_host": s["host"], "server_ip": s["ip"], "server_region": s["region"], "latency_ms": latency_ms, "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")}


@app.post("/api/log-usage/{model_type}")
async def log_usage(model_type: str, request: Request):
    if model_type not in ["4cls", "yolo", "radio"]:
        raise HTTPException(status_code=400, detail="Invalid model type")
    await log_model_usage(request, model_type)
    return {"status": "success"}


@app.post("/api/admin/seed")
async def seed_inspections():
    """Seed the database with 30 real RT weld scans and predictions from data\\Welds."""
    import random
    import base64
    from datetime import datetime, timedelta
    
    # 1. Clear previous seeds
    await db.inspections.delete_many({"seeded": True})
    
    # 2. Scan data\\Welds for RT images
    weld_dir = r"E:\FINALE PROJECT\data\Welds\Welds"
    if not os.path.exists(weld_dir):
        raise HTTPException(status_code=404, detail=f"Weld scan directory not found at: {weld_dir}")
        
    all_images = []
    for root, dirs, files in os.walk(weld_dir):
        for f in files:
            if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                all_images.append(os.path.join(root, f))
                
    if not all_images:
        raise HTTPException(status_code=404, detail="No RT weld scans found in directory.")
        
    random.shuffle(all_images)
    selected_images = all_images[:30]
    
    # 3. Get YOLO model
    model = get_yolo()
    
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
        # A. Read and base64-encode
        try:
            with open(img_path, "rb") as image_file:
                encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                mime = "image/png" if img_path.lower().endswith(".png") else "image/jpeg"
                base64_image = f"data:{mime};base64,{encoded_string}"
        except Exception:
            continue
            
        # B. Run actual model prediction
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
                        
                        detections.append({
                            "type": "box",
                            "label": label,
                            "confidence": conf,
                            "xyxy": [x1, y1, x2, y2]
                        })
                        
                        # Generate polygon mask
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
            except Exception:
                pass
                
        # C. Decide verdict logically
        has_defects = len(detections) > 0
        if not has_defects:
            decision = "Accepted"
        else:
            decision = "Refused"
                
        # D. Metadata & Timestamps
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
            "weld_id": f"W-RT-2026-{i:03d}",
            "thickness_mm": float(proj["thickness_mm"] + random.choice([-1.5, 0.0, 1.5, 2.5])),
            "standard": proj["standard"],
            "material": proj["material"],
            "seeded": True
        }
        seeded_records.append(record)
        
    if seeded_records:
        await db.inspections.insert_many(seeded_records)
        return {"status": "success", "count": len(seeded_records)}
    else:
        raise HTTPException(status_code=500, detail="Failed to seed any records.")



# ─── Analytics ─────────────────────────────────────────────────────────────────

@app.get("/api/analytics/summary")
async def get_analytics_summary():
    """Aggregate inspection statistics from MongoDB for the Analytics dashboard."""
    all_inspections = await db.inspections.find().to_list(10000)
    total = len(all_inspections)
    accepted = sum(1 for i in all_inspections if i.get("decision") == "Accepted")
    refused  = sum(1 for i in all_inspections if i.get("decision") == "Refused")
    pending  = sum(1 for i in all_inspections if not i.get("decision"))

    # Defect distribution across all inspections
    defect_counts: dict = {}
    for insp in all_inspections:
        for det in insp.get("detections", []):
            label = det.get("label", "unknown")
            defect_counts[label] = defect_counts.get(label, 0) + 1

    defect_distribution = [{"type": k, "count": v} for k, v in sorted(defect_counts.items(), key=lambda x: -x[1])]

    # Monthly trend (last 6 months based on timestamp string)
    from datetime import datetime, timedelta
    monthly: dict = {}
    now = datetime.now()
    for i in range(5, -1, -1):
        month_key = (now - timedelta(days=30 * i)).strftime("%b")
        monthly[month_key] = 0
    for insp in all_inspections:
        try:
            ts = insp.get("timestamp", "")
            dt = datetime.strptime(ts.split(",")[0].strip() if "," in ts else ts.split(" ")[0], "%m/%d/%Y")
            mk = dt.strftime("%b")
            if mk in monthly:
                monthly[mk] += 1
        except Exception:
            pass
    monthly_trend = [{"month": k, "count": v} for k, v in monthly.items()]

    # Project-level breakdown
    project_metrics = {}
    for insp in all_inspections:
        p_name = insp.get("project_name") or "Unknown Project"
        if p_name not in project_metrics:
            project_metrics[p_name] = {
                "project_name": p_name,
                "client_name": insp.get("client_name") or "N/A",
                "total": 0,
                "accepted": 0,
                "refused": 0,
                "cracks": 0,
                "volumetric": 0,
                "union": 0,
                "surface": 0
            }
        p_data = project_metrics[p_name]
        p_data["total"] += 1
        dec = insp.get("decision")
        if dec == "Accepted":
            p_data["accepted"] += 1
        elif dec == "Refused":
            p_data["refused"] += 1
            
        for det in insp.get("detections", []):
            lbl = det.get("label")
            if lbl == "crack":
                p_data["cracks"] += 1
            elif lbl == "volumetric":
                p_data["volumetric"] += 1
            elif lbl == "union":
                p_data["union"] += 1
            elif lbl == "surface":
                p_data["surface"] += 1
                
    project_breakdown = list(project_metrics.values())

    return {
        "total_inspections": total,
        "accepted": accepted,
        "refused": refused,
        "pending": pending,
        "acceptance_rate": round(accepted / total * 100, 1) if total else 0,
        "defect_distribution": defect_distribution,
        "monthly_trend": monthly_trend,
        "project_breakdown": project_breakdown
    }


# ─── Audit Log ─────────────────────────────────────────────────────────────────

@app.get("/api/audit-log")
async def get_audit_log(request: Request):
    """Full audit trail — admin only in practice (frontend enforces role check)."""
    logs = await db.activity.find().sort("timestamp", -1).to_list(500)
    return [
        {
            "username": l.get("username", "Anonymous"),
            "ip":       l.get("ip", "0.0.0.0"),
            "action":   l.get("action", "Unknown"),
            "model":    l.get("model_type", "-"),
            "time":     time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", time.time()))),
        }
        for l in logs
    ]


# ─── Users ─────────────────────────────────────────────────────────────────────

@app.get("/api/users")
async def get_users():
    registered = await db.registered_users.find().to_list(1000)
    now = time.time()
    result = []
    for user in registered:
        username = user.get("username", "Unknown")
        conn = await db.connections.find_one({"username": username})
        ip = conn.get("ip", "N/A") if conn else "N/A"
        last_seen = conn.get("last_seen", 0) if conn else 0
        is_online = (now - last_seen) < 300 if last_seen else False
        result.append({"username": username, "role": user.get("role", "Inspector"), "ip": ip, "status": "ONLINE" if is_online else "OFFLINE"})
    return result


# ─── Chats ─────────────────────────────────────────────────────────────────────

@app.get("/api/chats", response_model=List[ChatSession])
async def get_chats(request: Request):
    user_id   = request.headers.get("x-user-id", "")
    user_role = request.headers.get("x-user-role", "Inspector")
    query = {} if user_role in ["Lead Inspector", "admin"] else {"username": user_id}
    chats = await db.chats.find(query).to_list(1000)
    return chats


@app.post("/api/chats")
async def save_chat(chat: ChatSession, request: Request):
    # Qwen chat logs removed
    await db.chats.replace_one({"id": chat.id}, chat.dict(), upsert=True)
    return {"status": "success"}


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: float):
    await db.chats.delete_one({"id": chat_id})
    return {"status": "success"}


# ─── Inspections ───────────────────────────────────────────────────────────────

@app.get("/api/inspections")
async def get_inspections(request: Request):
    user_id   = request.headers.get("x-user-id", "")
    user_role = request.headers.get("x-user-role", "Inspector")
    query = {} if user_role in ["Lead Inspector", "admin"] else {"username": user_id}
    inspections = await db.inspections.find(query).sort("id", -1).to_list(1000)
    for i in inspections:
        i["_id"] = str(i["_id"])
    return inspections


@app.post("/api/inspections")
async def save_inspection(inspection: InspectionRecord, request: Request):
    await log_model_usage(request, "4cls")
    await db.inspections.insert_one(inspection.dict())
    return {"status": "success"}


@app.patch("/api/inspections/{inspection_id}")
async def update_inspection(inspection_id: float, request: Request):
    data = await request.json()
    decision = data.get("decision")
    if decision:
        await db.inspections.update_one({"id": inspection_id}, {"$set": {"decision": decision}})
    return {"status": "success"}


@app.delete("/api/inspections/{inspection_id}")
async def delete_inspection(inspection_id: float, request: Request):
    user_role = request.headers.get("x-user-role", "Inspector")
    user_id   = request.headers.get("x-user-id", "")
    inspection = await db.inspections.find_one({"id": inspection_id})
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if user_role not in ["Lead Inspector", "admin"] and inspection.get("username") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this record")
    await db.inspections.delete_one({"id": inspection_id})
    return {"status": "success"}


# ─── Retrain Dataset Collection ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "active_learning_dataset")
IMAGES_DIR = os.path.join(DATASET_DIR, "images")
LABELS_DIR = os.path.join(DATASET_DIR, "labels")

class CorrectionLabel(BaseModel):
    label: str
    points: Optional[List[List[float]]] = None
    xyxy: Optional[List[float]] = None

class RetrainSaveRequest(BaseModel):
    image_base64: str
    filename: str
    labels: List[CorrectionLabel]

@app.post("/api/retrain/save")
async def save_retrain_data(req: RetrainSaveRequest):
    try:
        # Clean and construct filenames
        safe_filename = os.path.basename(req.filename)
        name_part, ext_part = os.path.splitext(safe_filename)
        if not ext_part.lower() in [".jpg", ".jpeg", ".png", ".webp"]:
            ext_part = ".jpg"
        
        timestamp = int(time.time() * 1000)
        unique_name = f"{name_part}_{timestamp}{ext_part}"
        label_name = f"{name_part}_{timestamp}.txt"

        # Decode base64 image
        img_data_str = req.image_base64
        if "," in img_data_str:
            img_data_str = img_data_str.split(",")[1]
        
        img_bytes = base64.b64decode(img_data_str)

        # Get image dimensions
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image base64 data")
        
        img_h, img_w = img.shape[:2]

        # Ensure directories exist
        os.makedirs(IMAGES_DIR, exist_ok=True)
        os.makedirs(LABELS_DIR, exist_ok=True)

        # Save image file
        image_path = os.path.join(IMAGES_DIR, unique_name)
        with open(image_path, "wb") as f:
            f.write(img_bytes)

        # Map to class IDs
        CLASS_MAP = {
            "porosity": 0,
            "slag": 1,
            "crack": 2,
            "tungsten": 3,
            "undercut": 4,
            "lack_of_fusion": 5,
            "lack_of_penetration": 6,
            "spatter": 7,
            "volumetric": 0,
            "union": 5,
            "surface": 4
        }

        # Save YOLO label file
        label_path = os.path.join(LABELS_DIR, label_name)
        with open(label_path, "w") as f_label:
            for item in req.labels:
                lbl_clean = item.label.lower().replace(" ", "_")
                class_id = CLASS_MAP.get(lbl_clean, 0)

                # If we have polygon points
                if item.points and len(item.points) >= 3:
                    norm_pts = []
                    for pt in item.points:
                        px = min(max(pt[0] / img_w, 0.0), 1.0)
                        py = min(max(pt[1] / img_h, 0.0), 1.0)
                        norm_pts.append(f"{px:.6f} {py:.6f}")
                    pts_str = " ".join(norm_pts)
                    f_label.write(f"{class_id} {pts_str}\n")
                
                # If we only have bounding box xyxy
                elif item.xyxy and len(item.xyxy) == 4:
                    x1, y1, x2, y2 = item.xyxy
                    pts = [
                        [x1, y1],
                        [x2, y1],
                        [x2, y2],
                        [x1, y2]
                    ]
                    norm_pts = []
                    for pt in pts:
                        px = min(max(pt[0] / img_w, 0.0), 1.0)
                        py = min(max(pt[1] / img_h, 0.0), 1.0)
                        norm_pts.append(f"{px:.6f} {py:.6f}")
                    pts_str = " ".join(norm_pts)
                    f_label.write(f"{class_id} {pts_str}\n")

        return {
            "status": "success",
            "message": f"Corrected image and labels saved for active learning retraining.",
            "filename": unique_name,
            "num_labels": len(req.labels)
        }
    except Exception as e:
        print(f"[Retrain Save Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Serve Static (Vite build) ─────────────────────────────────────────────────
dist_path = os.path.join(os.path.dirname(__file__), "..", "dist")
if os.path.exists(dist_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_path, "assets")), name="static")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="API route not found")
        return FileResponse(os.path.join(dist_path, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "WeldSight API is running. (Frontend not built yet)"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
