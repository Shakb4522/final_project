# Industrial AI Inspection Hub

A professional, high-fidelity platform for industrial quality assurance, combining Computer Vision (AI) with expert analysis.

## 🚀 Key Features

### 1. AI Inspection Analysis
*   **Object Detection**: Uses a custom-trained **YOLOv8** model (hosted on Hugging Face) to detect welding defects in radiography images.
*   **Expert AI Assistant**: A technical consultant (Qwen 2.5) that interprets detection results and provides guidance based on **ISO, AWS, and ASME** standards.
*   **High-Fidelity UI**: Interactive SVG annotations and real-time result streaming.



## 🛠 System Architecture & Data Transfer

The system is designed as a **Distributed Cyber-Physical System**:

1.  **Browser (React/Vite)**: The user interface where images are uploaded and results are visualized.
2.  **Hugging Face (Inference Engine)**:
    *   **Model 1 (YOLOv8)**: Located at `chakib2f2sdf/my-yolo-detector`. Receives the raw image and returns bounding box/mask coordinates via the Gradio API.
    *   **Model 2 (LLM)**: Located at `Qwen/Qwen2.5-7B-Instruct`. Receives the detection summary and provides technical engineering advice.
3.  **Render (Coordination Hub)**:
    *   **FastAPI Backend**: Manages the API endpoints for chat history and audit logs.
    *   **MongoDB Atlas**: Persistent storage for all inspection records and expert chat sessions.

### Data Flow Logic:
*   **Inference**: Browser → Hugging Face (YOLO) → Browser.
*   **Audit/History**: Browser → Render (FastAPI) → MongoDB.
*   **Consultation**: Browser → Hugging Face (LLM) → Browser.

## 💻 Technical Stack
*   **Frontend**: React, Framer Motion, TailwindCSS, Vite.
*   **Backend**: FastAPI (Python), Motor (Async MongoDB).
*   **AI**: YOLOv8, Hugging Face Inference API, Gradio Client.
*   **Deployment**: Render.com (Frontend & Backend).
