# Ground Control Setup Guide (Handover)

## 1) System Overview

This project is a local drone ground-control platform with:
- Live video streaming (Jetson / UniRC RTSP / Laptop USB cam / local MP4)
- YOLO detection modes:
  - `people_online` (person detection using `yolov8n.pt`)
  - `balloon` (custom local model `weights.pt`)
- Live GPS telemetry from MAVLink (`jetson_gps_bridge.py`)
- Capture -> cluster -> victim group GPS extraction
- QGC mission file generation (`QGC WPL 110`)

---

## 2) Prerequisites

- Windows machine
- Python 3.10+ (tested with Python 3.13)
- `pip`
- MAVLink source (Cube/telemetry/bridge)
- Model files in repo root:
  - `weights.pt`
  - `yolov8n.pt`

---

## 3) Install Environment

From project root:

```powershell
cd C:\projects\ground_control
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Main dependencies from `requirements.txt`:
- Flask, flask-sock, flask-cors
- ultralytics
- opencv-python-headless
- numpy, scikit-learn
- pymavlink

---

## 4) Environment Configuration (`.env`)

Current baseline config:

```env
VIDEO_SOURCE_MODE=unirc_rtsp
UNIRC_RTSP_URL=rtsp://192.168.144.25:8554/main.264
UNIRC_RTSP_TRANSPORT=tcp

LIVE_STREAM_ENABLE_AI=on
YOLO_FRAME_SKIP=5
YOLO_LIVE_CONF=0.25
YOLO_PEOPLE_CONF=0.60
YOLO_INFER_MAX_DIM=832
LIVE_STREAM_TARGET_FPS=12
LIVE_STREAM_JPEG_QUALITY=70
LIVE_STREAM_MAX_WIDTH=960

MAVLINK_CONNECTION=udpin:0.0.0.0:14569
MAVLINK_BAUD=115200
GPS_INTERVAL_HZ=5
GPS_SOURCE_MODE=jetson_http
GPS_SOURCE_URL=http://127.0.0.1:5002/gps
LOCAL_GPS_BRIDGE=1

MISSION_WAYPOINT_ALT_M=16.0

YOLO_DETECTION_MODE=people_online
YOLO_PEOPLE_MODEL_PATH=C:\projects\ground_control\yolov8n.pt
```

---

## 5) Run the System Locally

You must run **2 services**.

### Terminal A: GPS Bridge
```powershell
cd C:\projects\ground_control
python jetson_gps_bridge.py
```

Telemetry endpoint:
- `http://127.0.0.1:5002/gps`

### Terminal B: Main Backend + Website
```powershell
cd C:\projects\ground_control
python app.py
```

Web app:
- `http://127.0.0.1:5000`

LAN access:
- `http://<laptop-ip>:5000`

---

## 6) Basic Operation Flow

1. Open website (`/`)
2. Select **Source Control** video source:
   - `Jetson Nano (Live)`
   - `UniRC 7 (Live)`
   - `Laptop USB Cam (Live)`
   - or MP4 file
3. Select Detection Mode:
   - `People Detection (Online)`
   - `Balloon Detection (Local)`
4. Click **Start Stream**
5. Click **Capture**
6. Click **Run Clustering**
7. Download:
   - Coordinates JSON
   - QGC mission `.waypoints` file

---

## 7) Key API Endpoints

- `GET /gps` -> live telemetry
- `GET /stats` -> live detection + FPS stats
- `GET /live_stream` -> live MJPEG stream
- `GET /stream` -> local video stream (MP4 / USB cam)
- `POST /capture` -> capture frame
- `POST /cluster_image` -> detection + clustering + GPS projection
- `GET/POST /api/detection_mode` -> get/set detection mode
- `GET /api/navigation/track` -> navigation track
- `GET /api/missions` -> mission history (when Supabase configured)

---

## 8) Common Troubleshooting

### A) “Failed to change detection mode”
- Ensure backend is running latest `app.py`
- Check endpoint:
  - `http://127.0.0.1:5000/api/detection_mode`
- Restart backend if needed

### B) No GPS data
- Check `jetson_gps_bridge.py` is running
- Check `MAVLINK_CONNECTION` port/source
- Verify `GPS_SOURCE_URL=http://127.0.0.1:5002/gps`

### C) USB cam cannot open
- Close Zoom/Teams/Camera app (camera may be locked)
- Re-select source: `Laptop USB Cam (Live)`
- Restart backend

### D) False positives in people mode
- Increase `YOLO_PEOPLE_CONF` (example: `0.65` to `0.75`)
- Keep camera angle stable and improve lighting

---

## 9) Handover Checklist

- [ ] Python env created and dependencies installed
- [ ] `.env` configured correctly
- [ ] `jetson_gps_bridge.py` running
- [ ] `app.py` running
- [ ] Website reachable at `:5000`
- [ ] Live source selectable and streaming
- [ ] Detection mode switch works
- [ ] Capture + clustering works
- [ ] Waypoint export works
