from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename
import base64
import io
from PIL import Image
import numpy as np
import cv2
from ultralytics import YOLO
import torch
import random
import google.generativeai as genai
genai.configure(api_key="AIzaSyBSBd7-8aW0-ntXah9T8p3Vc93X6uF98ag")



app = Flask(__name__)
CORS(app)  # Enable CORS

# Disable Flask's reloader for stability with YOLO
use_reloader = False
model_OCR = genai.GenerativeModel("gemini-1.5-flash")

# Load model once at startup
model = YOLO("./FlaskServer/BackendServer/best.pt")
model.to("cuda" if torch.cuda.is_available() else "cpu")
print(f"Model loaded on {model.device} device")

# Custom label mapping (your own class names)
custom_label_map = {
    0: "Question",
    1: "Answer",
    2: "Pair"
}


def generate_label_colors(labels):
    random.seed(42)  # for consistent color assignment
    colors = {}
    for label in labels:
        colors[label] = tuple(random.randint(0, 255) for _ in range(3))
    return colors

label_colors = generate_label_colors(custom_label_map.values())



def get_intersection_area(box1, box2):
    x1, y1, x2, y2 = box1
    x3, y3, x4, y4 = box2
    xi1 = max(x1, x3)
    yi1 = max(y1, y3)
    xi2 = min(x2, x4)
    yi2 = min(y2, y4)
    if xi2 <= xi1 or yi2 <= yi1:
        return 0
    intersection_area = (xi2 - xi1) * (yi2 - yi1)
    return intersection_area

def get_box_area(box):
    x1, y1, x2, y2 = box
    return (x2 - x1) * (y2 - y1)

def extract_text_gemini(cropped_image_np):
    try:
        # Encode image to JPEG bytes
        success, encoded_image = cv2.imencode('.jpg', cropped_image_np)
        if not success:
            return ""

        image_bytes = encoded_image.tobytes()

        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content([
            "Extract only the text from this image. Don't explain anything.",
            {
                "mime_type": "image/jpeg",
                "data": image_bytes
            }
        ])

        return response.text.strip()
    except Exception as e:
        print(f"Gemini OCR Error: {e}")
        return ""
def process_image(image_data):
    try:
        # Extract base64 data
        data = image_data.split(',', 1)[-1] if ',' in image_data else image_data
        
        # Decode base64
        image_bytes = base64.b64decode(data)
        image = Image.open(io.BytesIO(image_bytes))

        # Convert to OpenCV format
        image_np = np.array(image)[..., :3]  # Remove alpha if needed
        image_cv = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

        # Run YOLO
        results = model(image_cv, conf=0.25, iou=0.45)

        cropped_pairs = []
        qa_dict = {}
        boxes_info = []

        for result in results:
            for box in result.boxes:
                class_id = int(box.cls.item())
                label = custom_label_map.get(class_id, str(class_id))
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                boxes_info.append({
                    'label': label,
                    'coords': (x1, y1, x2, y2),
                    'center_y': (y1 + y2) // 2
                })

        # Sort Question and Answer boxes by vertical position
        questions = sorted([b for b in boxes_info if b['label'] == 'Question'], key=lambda b: b['center_y'])
        answers = sorted([b for b in boxes_info if b['label'] == 'Answer'], key=lambda b: b['center_y'])
        pairs = [b for b in boxes_info if b['label'] == 'Pair']

       

        for pair in pairs:
            x1, y1, x2, y2 = pair['coords']
            cropped = image_np[y1:y2, x1:x2]
            _, buffer = cv2.imencode('.jpg', cropped)
            encoded_crop = base64.b64encode(buffer).decode('utf-8')
            cropped_pairs.append(f"data:image/jpeg;base64,{encoded_crop}")

            max_q_overlap = 0
            best_q = None
            for q in questions:
                inter_area = get_intersection_area(pair['coords'], q['coords'])
                area_q = get_box_area(q['coords'])
                overlap_ratio = inter_area / area_q if area_q else 0
                if overlap_ratio > max_q_overlap:
                    max_q_overlap = overlap_ratio
                    best_q = q

            max_a_overlap = 0
            best_a = None
            for a in answers:
                inter_area = get_intersection_area(pair['coords'], a['coords'])
                area_a = get_box_area(a['coords'])
                overlap_ratio = inter_area / area_a if area_a else 0
                if overlap_ratio > max_a_overlap:
                    max_a_overlap = overlap_ratio
                    best_a = a

            q_text = ""
            a_text = ""
            if best_q:
                qx1, qy1, qx2, qy2 = best_q['coords']
                cropped_q = image_np[qy1:qy2, qx1:qx2]
                q_text = extract_text_gemini(cropped_q)

            if best_a:
                ax1, ay1, ax2, ay2 = best_a['coords']
                cropped_a = image_np[ay1:ay2, ax1:ax2]
                a_text = extract_text_gemini(cropped_a)

            qa_dict[q_text] = a_text

        return cropped_pairs, qa_dict
    
    except Exception as e:
        print(f"Error processing image: {str(e)}")
        raise


@app.route('/upload', methods=['POST'])
def upload():
    if not request.json or 'images' not in request.json:
        return jsonify({"error": "No images provided"}), 400
    
    try:
        results = []
        for image_data in request.json['images']:
            cropped_pairs, qa_dict = process_image(image_data)
            results.append({
                "cropped_pairs": cropped_pairs,
                "qa_dict": qa_dict

            })
        
        return jsonify({"results": results})
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=use_reloader  # Disable reloader for stability
    )