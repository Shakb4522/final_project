from fastapi import FastAPI, HTTPException, Request, UploadFile, File
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
from pathlib import Path
from dotenv import load_dotenv

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

# ─── YOLOv8 Local Model ────────────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent / "4_classe.pt"
_yolo_model = None

CLASS_NAMES = {0: "crack", 1: "volumetric", 2: "union", 3: "surface"}
MODEL_VERSION = "WeldSight-4CLS (P:78.8% R:67.8% mAP50:72.3%)"

def get_yolo():
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
            _yolo_model = YOLO(str(MODEL_PATH))
            print(f"[WeldSight] ✅ Loaded model: {MODEL_PATH}")
        except Exception as e:
            print(f"[WeldSight] ❌ Failed to load model: {e}")
    return _yolo_model


@app.on_event("startup")
async def startup():
    # Pre-load model
    get_yolo()
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
        "yolo":  "Used Visual YOLOv8 Model",
        "radio": "Used Radiographic YOLOv8 Model",
        "qwen":  "Used Qwen AI Chat",
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
async def analyze_image(request: Request, file: UploadFile = File(...)):
    """
    Run local WeldSight 4-Class model inference on an uploaded radiographic image.
    Returns detections in the same format as the original Gradio Space.
    """
    model = get_yolo()
    if model is None:
        raise HTTPException(status_code=503, detail="AI model not available. Check that 4_classe.pt is present.")

    # Save upload to a temp file
    suffix = Path(file.filename).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        results = model(tmp_path, imgsz=1280, conf=0.25, verbose=False)
        detections = []

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
                    "type":       "box",
                    "label":      label,
                    "confidence": conf,
                    "xyxy":       [x1, y1, x2, y2],
                })

        # Log usage
        await log_model_usage(request, "4cls")

        return {"detections": detections, "model_used": MODEL_VERSION}

    finally:
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
        {
            "model_name":  "Qwen-2.5-72B-Expert",
            "model_key":   "qwen",
            "status":      "OPERATIONAL",
            "uptime":      "99.95%",
            "description": "Expert AI consultation for industrial standards (ISO 5817, ASME IX, API 1104) and defect troubleshooting.",
        },
    ]


@app.get("/api/model-details/{model_key}")
async def get_model_details(model_key: str):
    if model_key not in ["4cls", "yolo", "radio", "qwen"]:
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
    if model_key not in ["4cls", "yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    logs = await db.activity.find({"model_type": model_key}).sort("timestamp", -1).to_list(5000)
    return [{"username": l.get("username"), "ip": l.get("ip", "0.0.0.0"), "action": l.get("action", ""), "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", time.time())))} for l in logs]


@app.post("/api/test-traffic/{model_key}")
async def test_traffic(model_key: str, request: Request):
    if model_key not in ["4cls", "yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    username = request.headers.get("x-user-id", "Anonymous")
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0] if forwarded else request.client.host
    start = time.time()
    await log_model_usage(request, model_key)
    latency_ms = round((time.time() - start) * 1000, 1)
    servers = {
        "4cls":  {"host": "localhost (WeldSight-4CLS)", "ip": "127.0.0.1", "region": "Local GPU (RTX 4060)"},
        "qwen":  {"host": "router.huggingface.co",     "ip": "3.163.189.74", "region": "US-East (Virginia)"},
        "yolo":  {"host": "localhost",                  "ip": "127.0.0.1", "region": "Local"},
        "radio": {"host": "localhost",                  "ip": "127.0.0.1", "region": "Local"},
    }
    s = servers[model_key]
    return {"status": "success", "client_ip": client_ip, "username": username, "server_host": s["host"], "server_ip": s["ip"], "server_region": s["region"], "latency_ms": latency_ms, "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")}


@app.post("/api/log-usage/{model_type}")
async def log_usage(model_type: str, request: Request):
    if model_type not in ["4cls", "yolo", "radio", "qwen"]:
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
    await log_model_usage(request, "qwen")
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
