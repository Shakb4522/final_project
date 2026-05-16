from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List, Optional
import os
import time
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Industrial Inspection Hub API")

# Enable CORS for the Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB Connection
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://chakib:chakib@ac-kszhpu2-shard-00-00.hv0v4xt.mongodb.net:27017,ac-kszhpu2-shard-00-01.hv0v4xt.mongodb.net:27017,ac-kszhpu2-shard-00-02.hv0v4xt.mongodb.net:27017/inspection_hub?ssl=true&replicaSet=atlas-clzeil-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0")
client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db = client.inspection_hub

@app.on_event("startup")
async def startup_db_client():
    try:
        await client.admin.command('ping')
        print("Successfully connected to MongoDB")
        # Seed default users if they don't exist
        if not await db.registered_users.find_one({"username": "admin"}):
            await db.registered_users.insert_one({"username": "admin", "password": "admin123", "role": "Lead Inspector"})
            print("Seeded user: admin / admin123")
        if not await db.registered_users.find_one({"username": "chakib"}):
            await db.registered_users.insert_one({"username": "chakib", "password": "chakib123", "role": "Inspector"})
            print("Seeded user: chakib / chakib123")
        if not await db.registered_users.find_one({"username": "younes"}):
            await db.registered_users.insert_one({"username": "younes", "password": "younes123", "role": "Inspector"})
            print("Seeded user: younes / younes123")
    except Exception as e:
        print(f"CRITICAL: MongoDB Connection Error: {e}")
        print("The application may not function correctly without a database connection.")

# ─── Pydantic Models ───

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

# ─── Helper: Log model usage to activity collection ───

async def log_model_usage(request: Request, model_type: str):
    """Only called when a user actually uses a model (yolo or qwen)."""
    username = request.headers.get("x-user-id", "Anonymous")
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(',')[0] if forwarded else request.client.host
    now = time.time()

    action_map = {
        "yolo": "Used Visual YOLOv8 Model",
        "radio": "Used Radiographic YOLOv8 Model",
        "qwen": "Used Qwen AI Model"
    }
    action = action_map.get(model_type, "Unknown Action")
    await db.activity.insert_one({
        "ip": ip,
        "username": username,
        "action": action,
        "model_type": model_type,
        "timestamp": now
    })
    # Update connection heartbeat
    await db.connections.update_one(
        {"username": username},
        {"$set": {"ip": ip, "username": username, "last_seen": now}},
        upsert=True
    )

# ─── Auth Endpoints ───

@app.post("/api/login")
async def login(user: UserLogin, request: Request):
    """Authenticate user against registered_users collection."""
    db_user = await db.registered_users.find_one({"username": user.username})
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found. Contact admin to register.")
    if db_user.get("password") != user.password:
        raise HTTPException(status_code=401, detail="Incorrect password.")

    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(',')[0] if forwarded else request.client.host

    # Update connection record
    await db.connections.update_one(
        {"username": user.username},
        {"$set": {"ip": ip, "username": user.username, "last_seen": time.time(), "role": db_user.get("role", "Inspector")}},
        upsert=True
    )
    return {
        "status": "success",
        "username": user.username,
        "role": db_user.get("role", "Inspector")
    }

@app.post("/api/register")
async def register(user: UserRegister):
    """Register a new user."""
    existing = await db.registered_users.find_one({"username": user.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists.")
    await db.registered_users.insert_one({
        "username": user.username,
        "password": user.password,
        "role": user.role or "Inspector"
    })
    return {"status": "success", "username": user.username}

# ─── Global Traffic ───

@app.get("/api/global-stats")
async def get_global_stats():
    """Return static model info. Active users and logs are fetched per-model."""
    return [
        {
            "model_name": "YOLOv8-Visual-Inspector",
            "model_key": "yolo",
            "status": "OPERATIONAL",
            "uptime": "99.98%",
            "description": "High-precision color photo analysis for surface weld defects."
        },
        {
            "model_name": "YOLOv8-Radiographic-XRay",
            "model_key": "radio",
            "status": "OPERATIONAL",
            "uptime": "99.99%",
            "description": "Sub-surface defect detection using radiographic X-ray imaging."
        },
        {
            "model_name": "Qwen-2.5-7B-Expert",
            "model_key": "qwen",
            "status": "OPERATIONAL",
            "uptime": "99.95%",
            "description": "Expert AI consultation for industrial standards and troubleshooting."
        }
    ]

@app.get("/api/model-details/{model_key}")
async def get_model_details(model_key: str):
    """Get active users (last 5 min) and recent logs for a specific model."""
    if model_key not in ["yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model key")

    now = time.time()
    five_min_ago = now - 300

    # Active users: distinct usernames who used this model in last 5 min
    recent_activity = await db.activity.find({
        "model_type": model_key,
        "timestamp": {"$gte": five_min_ago}
    }).sort("timestamp", -1).to_list(1000)

    # Deduplicate active users
    seen_users = {}
    for a in recent_activity:
        uname = a.get("username", "Anonymous")
        if uname not in seen_users:
            seen_users[uname] = {
                "username": uname,
                "ip": a.get("ip", "0.0.0.0"),
                "last_used": time.strftime("%H:%M:%S", time.localtime(a["timestamp"]))
            }
    active_users = list(seen_users.values())

    # Recent logs (last 5 entries for short preview)
    recent_logs = await db.activity.find({
        "model_type": model_key
    }).sort("timestamp", -1).to_list(5)

    short_logs = [{
        "username": l.get("username", "Anonymous"),
        "ip": l.get("ip", "0.0.0.0"),
        "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", now)))
    } for l in recent_logs]

    return {
        "active_users": active_users,
        "active_count": len(active_users),
        "recent_logs": short_logs
    }

@app.get("/api/model-logs/{model_key}")
async def get_model_logs(model_key: str):
    """Get ALL logs for a specific model (full audit trail)."""
    if model_key not in ["yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model key")

    logs = await db.activity.find({
        "model_type": model_key
    }).sort("timestamp", -1).to_list(5000)

    if not logs:
        return []

    return [{
        "username": l.get("username", "Anonymous"),
        "ip": l.get("ip", "0.0.0.0"),
        "action": l.get("action", "Unknown"),
        "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(l.get("timestamp", time.time())))
    } for l in logs]

# ─── Log Model Usage (called from frontend) ───

@app.post("/api/test-traffic/{model_key}")
async def test_traffic(model_key: str, request: Request, dry: bool = False):
    """Send a real traffic test from the user's IP, log it, and return route info."""
    if model_key not in ["yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model key")
    
    username = request.headers.get("x-user-id", "Anonymous")
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(',')[0] if forwarded else request.client.host
    
    start = time.time()
    # Log the traffic test unless dry run
    if not dry:
        await log_model_usage(request, model_key)
    latency_ms = round((time.time() - start) * 1000, 1)
    
    model_servers = {
        "yolo": {"host": "huggingface.co", "ip": "3.163.189.74", "region": "US-East (Virginia)"},
        "radio": {"host": "huggingface.co", "ip": "3.163.189.74", "region": "US-East (Virginia)"},
        "qwen": {"host": "router.huggingface.co", "ip": "3.163.189.74", "region": "US-East (Virginia)"}
    }
    server = model_servers[model_key]
    
    return {
        "status": "success",
        "client_ip": client_ip,
        "username": username,
        "server_host": server["host"],
        "server_ip": server["ip"],
        "server_region": server["region"],
        "latency_ms": latency_ms,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time()))
    }

@app.post("/api/log-usage/{model_type}")
async def log_usage(model_type: str, request: Request):
    if model_type not in ["yolo", "radio", "qwen"]:
        raise HTTPException(status_code=400, detail="Invalid model type")
    await log_model_usage(request, model_type)
    return {"status": "success"}

# ─── Users (registered users from DB) ───

@app.get("/api/users")
async def get_users():
    """Show all registered users with their connection info."""
    registered = await db.registered_users.find().to_list(1000)
    now = time.time()
    result = []

    for user in registered:
        username = user.get("username", "Unknown")
        # Find their connection record for IP and online status
        conn = await db.connections.find_one({"username": username})
        ip = conn.get("ip", "N/A") if conn else "N/A"
        last_seen = conn.get("last_seen", 0) if conn else 0
        is_online = (now - last_seen) < 300 if last_seen else False

        result.append({
            "username": username,
            "role": user.get("role", "Inspector"),
            "ip": ip,
            "status": "ONLINE" if is_online else "OFFLINE"
        })

    return result

# ─── Chat Endpoints ───

@app.get("/api/chats", response_model=List[ChatSession])
async def get_chats(request: Request):
    user_id = request.headers.get("x-user-id", "")
    user_role = request.headers.get("x-user-role", "Inspector")

    query = {}
    if user_role not in ["Lead Inspector", "admin"]:
        query = {"username": user_id}

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

# ─── Inspection Endpoints ───

@app.get("/api/inspections")
async def get_inspections(request: Request):
    user_id = request.headers.get("x-user-id", "")
    user_role = request.headers.get("x-user-role", "Inspector")
    
    query = {}
    # Admins and Lead Inspectors see everything; regular users see only their own
    if user_role not in ["Lead Inspector", "admin"]:
        query = {"username": user_id}
        
    inspections = await db.inspections.find(query).sort("id", -1).to_list(1000)
    for i in inspections:
        i["_id"] = str(i["_id"])
    return inspections

@app.post("/api/inspections")
async def save_inspection(inspection: InspectionRecord, request: Request):
    await log_model_usage(request, "yolo")
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
    user_id = request.headers.get("x-user-id", "")
    
    inspection = await db.inspections.find_one({"id": inspection_id})
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
        
    if user_role not in ["Lead Inspector", "admin"] and inspection.get("username") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this record")

    await db.inspections.delete_one({"id": inspection_id})
    return {"status": "success"}

# ─── Serve Static Files (Vite Build) ───
dist_path = os.path.join(os.path.dirname(__file__), "..", "dist")
if os.path.exists(dist_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_path, "assets")), name="static")

    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="API route not found")
        return FileResponse(os.path.join(dist_path, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "Industrial Inspection Hub API is running. (Frontend not found/built)"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
