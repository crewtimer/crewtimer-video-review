import argparse
import json
import os
import re
import cv2
import numpy as np
from pathlib import Path
from pynput import keyboard
from pynput import mouse
keypress =[0]
WindowName = "CrewTimer Image Labeling Tool"


# Try to import YOLO from ultralytics (YOLOv8) or fallback to yolov5
try:
    from ultralytics import YOLO
    YOLO_TYPE = 'ultralytics'
except ImportError:
    YOLO_TYPE = None
    try:
        import torch
        YOLO_TYPE = 'yolov5'
    except ImportError:
        pass

def load_model(model_path):
    if YOLO_TYPE == 'ultralytics':
        return YOLO(model_path, task='detect')
    elif YOLO_TYPE == 'yolov5':
        return torch.hub.load('ultralytics/yolov5', 'custom', path=model_path, force_reload=True)
    else:
        raise ImportError("Neither ultralytics YOLO nor yolov5 is installed. Please install one of them.")

def run_detection(model, image_path):
    if YOLO_TYPE == 'ultralytics':
        results = model(image_path)
        return results[0]
    elif YOLO_TYPE == 'yolov5':
        results = model(image_path)
        return results
    else:
        raise RuntimeError("Model type not supported.")
    
def draw_text(img, text, x, y, scale=1.0, color=(0,255,255), thickness=2, font=cv2.FONT_HERSHEY_SIMPLEX):
    """
    Draw text on an image at the specified (x, y) location with optional scale factor for font size.
    Draws a black rectangle background sized to the text.

    Args:
        img (np.ndarray): Image to draw on (modified in place).
        text (str): Text to draw.
        x (int): X coordinate for the bottom-left corner of the text.
        y (int): Y coordinate for the bottom-left corner of the text.
        scale (float, optional): Font scale factor. Default is 1.0.
        color (tuple, optional): Text color (B, G, R). Default is yellow.
        thickness (int, optional): Thickness of the text. Default is 2.
        font (int, optional): OpenCV font type. Default is cv2.FONT_HERSHEY_SIMPLEX.
    """
    # Calculate text size
    text_size, baseline = cv2.getTextSize(text, font, scale, thickness)
    text_w, text_h = text_size
    baseline = int(baseline)
    # Rectangle coordinates
    rect_x1 = x - 5
    rect_y1 = y - text_h - baseline - 5
    rect_x2 = x + text_w + 5
    rect_y2 = y + 5
    # Draw black rectangle background
    cv2.rectangle(img, (rect_x1, rect_y1), (rect_x2, rect_y2), (0,0,0), -1)
    # Draw text
    cv2.putText(img, text, (x, y), font, scale, color, thickness, cv2.LINE_AA)


def load_card_annotations(path, image_path, image_shape):
    """Load the structured bow-card sidecar for one source image."""
    h, w = image_shape[:2]
    if os.path.exists(path):
        try:
            with open(path, "r") as card_file:
                data = json.load(card_file)
            if isinstance(data, dict) and isinstance(data.get("cards"), list):
                return data
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Unable to read card annotations {path}: {exc}")
    return {
        "image": Path(image_path).name,
        "width": w,
        "height": h,
        "cards": [],
    }


def has_card_annotations(path):
    """Return True when a sidecar contains at least one labeled card."""
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r") as card_file:
            data = json.load(card_file)
        return (
            isinstance(data, dict)
            and isinstance(data.get("cards"), list)
            and len(data["cards"]) > 0
        )
    except (OSError, json.JSONDecodeError):
        return False


def has_bow_mismatch(path):
    """Return True only when the card sidecar explicitly flags a mismatch."""
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r") as card_file:
            data = json.load(card_file)
        if not isinstance(data, dict):
            return False
        if data.get("bowMismatch") is True:
            return True
        return any(
            isinstance(card, dict) and card.get("bowMismatch") is True
            for card in data.get("cards", [])
        )
    except (OSError, json.JSONDecodeError):
        return False


def has_multiple_boat_boxes(path):
    """Return True when a YOLO label file contains at least two boat boxes."""
    if not os.path.exists(path):
        return False
    try:
        boat_count = 0
        with open(path, "r") as label_file:
            for line in label_file:
                fields = line.split()
                if len(fields) < 5:
                    continue
                try:
                    class_id = int(float(fields[0]))
                    x_center, y_center, width, height = map(float, fields[1:5])
                except ValueError:
                    continue
                if (
                    class_id == 0
                    and width > 0
                    and height > 0
                    and 0 <= x_center <= 1
                    and 0 <= y_center <= 1
                ):
                    boat_count += 1
                    if boat_count > 1:
                        return True
        return False
    except OSError:
        return False


def save_card_annotations(path, annotations):
    """Write a bow-card sidecar without changing the YOLO boat labels."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with open(temp_path, "w") as card_file:
        json.dump(annotations, card_file, indent=2)
        card_file.write("\n")
    os.replace(temp_path, path)


def make_card_annotation(boat_index, boat_box, card_box, value, image_shape):
    """Build the persisted boat -> card -> OCR-value annotation."""
    h, w = image_shape[:2]
    x, y, width, height = card_box
    raw_value = value.upper()
    match = re.fullmatch(r"([A-Z]?)([0-9]{1,3})", raw_value)
    prefix = match.group(1) if match else ""
    digits = match.group(2) if match else ""
    legible = bool(match)
    return {
        "boatIndex": boat_index,
        "boatBox": {
            "x": int(boat_box[0]),
            "y": int(boat_box[1]),
            "width": int(boat_box[2]),
            "height": int(boat_box[3]),
        },
        "box": {
            "x": int(x),
            "y": int(y),
            "width": int(width),
            "height": int(height),
        },
        "normalizedBox": {
            "xCenter": round((x + width / 2) / w, 6),
            "yCenter": round((y + height / 2) / h, 6),
            "width": round(width / w, 6),
            "height": round(height / h, 6),
        },
        "value": raw_value if legible else "",
        "digits": digits,
        "prefix": prefix,
        "visibility": "clear" if legible else "unreadable",
        "partial": False,
        "polarity": "unknown",
        "legible": legible,
        "verified": legible,
    }


def apply_manual_card_correction(
    card_annotations, boat_index, annotation, previous_annotation=None
):
    """Clear a selected boat's mismatch after a manual value decision."""
    selected_boat_index = card_annotations.get("selectedBoatIndex")
    is_selected_boat = selected_boat_index == boat_index

    # Older sidecars may not have selectedBoatIndex. In that case, the card-level
    # mismatch flag identifies the selected finish-line boat.
    if selected_boat_index is None:
        is_selected_boat = (
            card_annotations.get("bowMismatch") is True
            and isinstance(previous_annotation, dict)
            and previous_annotation.get("bowMismatch") is True
        )

    if not is_selected_boat:
        return False

    annotation["bowMismatch"] = False
    card_annotations["bowMismatch"] = False
    if annotation.get("legible"):
        card_annotations["detectedBow"] = annotation["value"]
    return True


def clear_reviewed_mismatch(card_annotations, boat_index):
    """Clear mismatch metadata after reviewing a boat, even without a card."""
    selected_boat_index = card_annotations.get("selectedBoatIndex")
    if selected_boat_index is not None and selected_boat_index != boat_index:
        return False

    mismatch_cleared = card_annotations.get("bowMismatch") is True
    card_annotations["bowMismatch"] = False
    if "detectedDigits" in card_annotations:
        card_annotations["detectedDigits"] = ""

    for card in card_annotations.get("cards", []):
        if card.get("boatIndex") != boat_index:
            continue
        mismatch_cleared = mismatch_cleared or card.get("bowMismatch") is True
        card["bowMismatch"] = False
        card["detectedDigits"] = ""

    return mismatch_cleared


def draw_card_annotations(image, cards, active_boat_index=None):
    """Draw saved card boxes and values onto an image in-place."""
    for card in cards:
        box = card.get("box", {})
        try:
            x = int(box["x"])
            y = int(box["y"])
            width = int(box["width"])
            height = int(box["height"])
        except (KeyError, TypeError, ValueError):
            continue
        active = card.get("boatIndex") == active_boat_index
        color = (255, 255, 0) if active else (255, 180, 0)
        cv2.rectangle(image, (x, y), (x + width, y + height), color, 2)
        value = card.get("value") or "?"
        label = value
        detected_digits = str(card.get("detectedDigits") or "").strip()
        if card.get("bowMismatch") is True and detected_digits:
            label = f"{label} ({detected_digits})"
        font_scale = 1.2
        thickness = 3
        (_, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
        )
        label_y = y - 8
        if label_y - text_height - baseline < 0:
            label_y = min(image.shape[0] - baseline - 5, y + height + text_height + 8)
        draw_text(
            image,
            label,
            max(5, x),
            label_y,
            scale=font_scale,
            color=(255, 255, 255),
            thickness=thickness,
        )


def draw_card_blowup(panel, img, cards, active_boat_index, margin=10):
    """Overlay an enlarged view of the active boat's card in the panel's top-right corner."""
    card = next(
        (card for card in cards if card.get("boatIndex") == active_boat_index),
        None,
    )
    if card is None:
        return
    box = card.get("box", {})
    try:
        x = int(box["x"])
        y = int(box["y"])
        width = int(box["width"])
        height = int(box["height"])
    except (KeyError, TypeError, ValueError):
        return
    img_h, img_w = img.shape[:2]
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(img_w, x + width), min(img_h, y + height)
    if x2 <= x1 or y2 <= y1:
        return
    card_crop = img[y1:y2, x1:x2]

    # Scale the card up to fit within a quarter of the panel width and a third of its height
    panel_h, panel_w = panel.shape[:2]
    max_w = panel_w // 4
    max_h = panel_h // 3
    scale = min(max_w / card_crop.shape[1], max_h / card_crop.shape[0])
    new_w = max(1, int(card_crop.shape[1] * scale))
    new_h = max(1, int(card_crop.shape[0] * scale))
    blowup = cv2.resize(card_crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    ox = panel_w - new_w - margin
    oy = margin
    panel[oy:oy + new_h, ox:ox + new_w] = blowup
    cv2.rectangle(panel, (ox - 2, oy - 2), (ox + new_w + 1, oy + new_h + 1), (255, 255, 0), 2)
    value = card.get("value") or "?"
    draw_text(panel, value, ox + 5, oy + new_h - 10, scale=1.2, color=(255, 255, 255), thickness=3)


def label_card_for_boat(img, boat_box, existing_value=""):
    """
    Draw a card rectangle within a zoomed boat crop, then enter its OCR value.

    Returns ((x, y, width, height), value), or None when cancelled.
    """
    image_h, image_w = img.shape[:2]
    bx, by, bw, bh = boat_box
    margin_x = max(10, int(bw * 0.1))
    margin_y = max(10, int(bh * 0.25))
    crop_x1 = max(0, bx - margin_x)
    crop_y1 = max(0, by - margin_y)
    crop_x2 = min(image_w, bx + bw + margin_x)
    crop_y2 = min(image_h, by + bh + margin_y)
    crop = img[crop_y1:crop_y2, crop_x1:crop_x2]
    if crop.size == 0:
        return None

    max_width, max_height = 1800, 900
    scale = min(max_width / crop.shape[1], max_height / crop.shape[0])
    scale = max(1.0, min(scale, 6.0))
    display = cv2.resize(
        crop,
        (int(crop.shape[1] * scale), int(crop.shape[0] * scale)),
        interpolation=cv2.INTER_LANCZOS4,
    )
    window = "Bow Card Label"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
    selected = cv2.selectROI(
        window, display, showCrosshair=True, fromCenter=False
    )
    if selected[2] <= 1 or selected[3] <= 1:
        cv2.destroyWindow(window)
        return None

    sx, sy, sw, sh = selected
    card_box = (
        max(0, int(round(crop_x1 + sx / scale))),
        max(0, int(round(crop_y1 + sy / scale))),
        max(1, int(round(sw / scale))),
        max(1, int(round(sh / scale))),
    )

    value = existing_value.upper()
    while True:
        value_display = display.copy()
        cv2.rectangle(
            value_display,
            (int(sx), int(sy)),
            (int(sx + sw), int(sy + sh)),
            (255, 255, 0),
            2,
        )
        draw_text(
            value_display,
            f"Value: {value}_   ?=unreadable  Enter=save  Esc=cancel",
            10,
            35,
            scale=0.8,
            color=(255, 255, 0),
            thickness=2,
        )
        cv2.imshow(window, value_display)
        key = cv2.waitKey(20) & 0xFF
        if key in (13, 10):
            if value == "?" or re.fullmatch(r"[A-Z]?[0-9]{1,3}", value):
                cv2.destroyWindow(window)
                return card_box, value
        elif key == 27:
            cv2.destroyWindow(window)
            return None
        elif key in (8, 127):
            value = value[:-1]
        elif ord("0") <= key <= ord("9") and len(value) < 4:
            value += chr(key)
        elif ord("a") <= key <= ord("z") and not value:
            value = chr(key).upper()
        elif ord("A") <= key <= ord("Z") and not value:
            value = chr(key)
        elif key == ord("?"):
            value = "?"


def relabel_existing_card(img, card, existing_value=""):
    """Edit a bow value while preserving the existing card bounding box."""
    box = card.get("box", {})
    try:
        x = int(box["x"])
        y = int(box["y"])
        width = int(box["width"])
        height = int(box["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 1 or height <= 1:
        return None

    pad_x = max(50, width * 2)
    pad_y = max(50, height * 2)
    crop_x1 = max(0, x - pad_x)
    crop_y1 = max(0, y - pad_y)
    crop_x2 = min(img.shape[1], x + width + pad_x)
    crop_y2 = min(img.shape[0], y + height + pad_y)
    crop = img[crop_y1:crop_y2, crop_x1:crop_x2]
    if crop.size == 0:
        return None

    scale = min(1800 / crop.shape[1], 900 / crop.shape[0])
    scale = max(1.0, min(scale, 6.0))
    display = cv2.resize(
        crop,
        (int(crop.shape[1] * scale), int(crop.shape[0] * scale)),
        interpolation=cv2.INTER_LANCZOS4,
    )
    sx = int(round((x - crop_x1) * scale))
    sy = int(round((y - crop_y1) * scale))
    sw = int(round(width * scale))
    sh = int(round(height * scale))
    value = existing_value.upper()
    window = "Bow Card Label"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
    while True:
        value_display = display.copy()
        cv2.rectangle(
            value_display, (sx, sy), (sx + sw, sy + sh), (255, 255, 0), 2
        )
        draw_text(
            value_display,
            f"Value: {value}_   ?=unreadable  Enter=save  Esc=cancel",
            10,
            35,
            scale=0.8,
            color=(255, 255, 0),
            thickness=2,
        )
        cv2.imshow(window, value_display)
        key = cv2.waitKey(20) & 0xFF
        if key in (13, 10):
            if value == "?" or re.fullmatch(r"[A-Z]?[0-9]{1,3}", value):
                cv2.destroyWindow(window)
                return value
        elif key == 27:
            cv2.destroyWindow(window)
            return None
        elif key in (8, 127):
            value = value[:-1]
        elif ord("0") <= key <= ord("9") and len(value) < 4:
            value += chr(key)
        elif ord("a") <= key <= ord("z") and not value:
            value = chr(key).upper()
        elif ord("A") <= key <= ord("Z") and not value:
            value = chr(key)
        elif key == ord("?"):
            value = "?"

def print_image_size(title, img):
    """
    Print the width x height of an image with a title label.
    
    Args:
        title (str): Descriptive title to print.
        img (numpy.ndarray): Image array loaded via OpenCV.
    """
    if img is None:
        print(f"{title}: Image is None")
    else:
        height, width = img.shape[:2]
        # print(f"{title}: {width}x{height}")

def resize_and_pad(img, target_width, target_height, align='center', pad_color=(0, 0, 0), pad=0):
    """
    Resize an image to fit within (target_width, target_height) while maintaining aspect ratio.
    Add 'pad' pixels on all sides within the target size, then pad the result with pad_color to fill the target size.
    If align='fill', expand the image to fill the available space without preserving aspect ratio.

    Args:
        img (np.ndarray): Input image.
        target_width (int): Target width.
        target_height (int): Target height.
        align (str): Vertical alignment of the image in the padded result.
                     'center' (default) - center the image vertically,
                     'top' - align the image to the top,
                     'bottom' - align the image to the bottom.
                     'fill' - expand image to fill available space, ignoring aspect ratio.
        pad_color (tuple): Color for padding (B, G, R).
        pad (int): Number of pixels to pad on all sides inside the target size.

    Returns:
        np.ndarray: Resized and padded image of shape (target_height, target_width, 3).
    """
    h, w = img.shape[:2]
    # Adjust the available area for the image by subtracting 2*pad from each dimension
    avail_width = max(1, target_width - 2 * pad)
    avail_height = max(1, target_height - 2 * pad)

    if align == 'fill':
        # Ignore aspect ratio, stretch to fill available area
        resized = cv2.resize(img, (avail_width, avail_height), interpolation=cv2.INTER_LANCZOS4)
        pad_left_inner = 0
        pad_right_inner = 0
        pad_top_inner = 0
        pad_bottom_inner = 0
    else:
        scale = min(avail_width / w, avail_height / h)
        new_w = int(w * scale)
        new_h = int(h * scale)
        resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

        # Compute padding inside the available area (centered horizontally)
        pad_left_inner = (avail_width - new_w) // 2
        pad_right_inner = avail_width - new_w - pad_left_inner

        # Compute vertical padding inside the available area based on align argument
        if align == 'top':
            pad_top_inner = 0
            pad_bottom_inner = avail_height - new_h
        elif align == 'bottom':
            pad_top_inner = avail_height - new_h
            pad_bottom_inner = 0
        else:  # center (default)
            pad_top_inner = (avail_height - new_h) // 2
            pad_bottom_inner = avail_height - new_h - pad_top_inner

    # First, pad the resized image to fill the available area (avail_width x avail_height)
    padded_inner = cv2.copyMakeBorder(
        resized, pad_top_inner, pad_bottom_inner, pad_left_inner, pad_right_inner,
        borderType=cv2.BORDER_CONSTANT, value=pad_color
    )
    # Then, pad with 'pad' pixels on all sides to reach the target size
    padded = cv2.copyMakeBorder(
        padded_inner, pad, pad, pad, pad,
        borderType=cv2.BORDER_CONSTANT, value=pad_color
    )
    return padded
def detections_to_yolo(results, image_shape):
    h, w = image_shape[:2]
    yolo_labels = []
    min_conf = 0.3
    if YOLO_TYPE == 'ultralytics':
        boxes = results.boxes
        for box in boxes:
            conf = float(box.conf[0])
            if conf < min_conf:
                continue
            print(conf)
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls = int(box.cls[0])
            # Convert to YOLO format
            x_c = (x1 + x2) / 2 / w
            y_c = (y1 + y2) / 2 / h
            bw = (x2 - x1) / w
            bh = (y2 - y1) / h
            yolo_labels.append(f"{cls} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}")
    elif YOLO_TYPE == 'yolov5':
        for *xyxy, conf, cls in results.xyxy[0].tolist():
            if conf < min_conf:
                continue
            print(conf)
            x1, y1, x2, y2 = xyxy
            cls = int(cls)
            x_c = (x1 + x2) / 2 / w
            y_c = (y1 + y2) / 2 / h
            bw = (x2 - x1) / w
            bh = (y2 - y1) / h
            yolo_labels.append(f"{cls} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}")
    return yolo_labels

def draw_new_bbox_inline(img, window_name, set_mouse_callback, label_lines, idx):
    h, w = img.shape[:2]
    drawing_new_bbox = [False]
    bbox_start = [0, 0]
    bbox_end = [0, 0]
    temp_bbox = []
    done = [False]
    inserted = [False]
    def draw_bbox_mouse_callback(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            drawing_new_bbox[0] = True
            bbox_start[0], bbox_start[1] = x, y
            bbox_end[0], bbox_end[1] = x, y
        elif event == cv2.EVENT_MOUSEMOVE and drawing_new_bbox[0]:
            bbox_end[0], bbox_end[1] = x, y
        elif event == cv2.EVENT_LBUTTONUP:
            if not drawing_new_bbox[0]:
                return # ignore if no proceeded by button down
            drawing_new_bbox[0] = False
            bbox_end[0], bbox_end[1] = x, y
            # Ensure top-left to bottom-right order
            x1, y1 = min(bbox_start[0], bbox_end[0]), min(bbox_start[1], bbox_end[1])
            x2, y2 = max(bbox_start[0], bbox_end[0]), max(bbox_start[1], bbox_end[1])
            temp_bbox.clear()
            temp_bbox.extend([x1, y1, x2, y2])
    set_mouse_callback(window_name, draw_bbox_mouse_callback)
    while not done[0]:
        vis2 = img.copy()
        if drawing_new_bbox[0] or temp_bbox:
            x1, y1 = bbox_start[0], bbox_start[1]
            x2, y2 = bbox_end[0], bbox_end[1]
            cv2.rectangle(vis2, (x1, y1), (x2, y2), (0,0,255), 2)
        cv2.imshow(window_name, vis2)
        k2 = cv2.waitKey(10) & 0xFF
        if not drawing_new_bbox[0] and temp_bbox:
            x1, y1, x2, y2 = temp_bbox
            x1, x2 = max(0, min(x1, w)), max(0, min(x2, w))
            y1, y2 = max(0, min(y1, h)), max(0, min(y2, h))
            if abs(x2-x1) > 1 and abs(y2-y1) > 1:
                x_c = (x1 + x2) / 2 / w
                y_c = (y1 + y2) / 2 / h
                bw = abs(x2 - x1) / w
                bh = abs(y2 - y1) / h
                new_line = f"0 {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}"
                label_lines.insert(idx, new_line)
                inserted[0] = True
            temp_bbox.clear()
            done[0] = True
        if k2 == 27:  # ESC to cancel
            temp_bbox.clear()
            done[0] = True
            inserted[0] = False
    set_mouse_callback(window_name, None)
    # Flush OpenCV event queue to avoid ESC propagating to main loop
    for _ in range(5):
        cv2.waitKey(1)
    keypress[0]=0

    return inserted[0]


def show_no_detections_ui(img, filename, old_mouse_callback):
    # Overlay two buttons: Skip File and Create bounding box on the main display window
    h, w = img.shape[:2]
    display = img.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    user_choice = [None]
    # Button text and font sizes
    skip_text = "Skip File"
    create_text = "Create bounding box"
    skip_font_scale = 1.5
    create_font_scale = 1.2
    thickness = 3
    pad_x = 40
    pad_y = 30
    # Calculate text sizes
    skip_text_size, _ = cv2.getTextSize(skip_text, font, skip_font_scale, thickness)
    create_text_size, _ = cv2.getTextSize(create_text, font, create_font_scale, thickness)
    button_h = max(skip_text_size[1], create_text_size[1]) + 2*pad_y
    button_w_skip = skip_text_size[0] + 2*pad_x
    button_w_create = create_text_size[0] + 2*pad_x
    gap = 40
    start_y = h // 2 - button_h - gap//2
    skip_rect = (w//2 - button_w_skip - gap//2, start_y, w//2 - gap//2, start_y + button_h)
    create_rect = (w//2 + gap//2, start_y, w//2 + button_w_create + gap//2, start_y + button_h)
    
    # Set up mouse callback for the main window
    def mouse_callback(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            if skip_rect[0] <= x <= skip_rect[2] and skip_rect[1] <= y <= skip_rect[3]:
                user_choice[0] = 'skip'
            if create_rect[0] <= x <= create_rect[2] and create_rect[1] <= y <= create_rect[3]:
                user_choice[0] = 'create'
    cv2.setMouseCallback(WindowName, mouse_callback)
    while True:
        temp = display.copy()
        # Draw buttons with rectangles sized to text
        cv2.rectangle(temp, (skip_rect[0], skip_rect[1]), (skip_rect[2], skip_rect[3]), (50,50,50), -1)
        cv2.rectangle(temp, (create_rect[0], create_rect[1]), (create_rect[2], create_rect[3]), (50,50,50), -1)
        # Center text in button
        skip_text_x = skip_rect[0] + (button_w_skip - skip_text_size[0]) // 2
        skip_text_y = skip_rect[1] + (button_h + skip_text_size[1]) // 2
        create_text_x = create_rect[0] + (button_w_create - create_text_size[0]) // 2
        create_text_y = create_rect[1] + (button_h + create_text_size[1]) // 2
        cv2.putText(temp, skip_text, (skip_text_x, skip_text_y), font, skip_font_scale, (255,255,255), thickness, cv2.LINE_AA)
        cv2.putText(temp, create_text, (create_text_x, create_text_y), font, create_font_scale, (255,255,255), thickness, cv2.LINE_AA)
        # Overlay filename
        cv2.putText(temp, f"No detections for {filename}", (40, 60), font, 1.0, (0,0,255), 3, cv2.LINE_AA)
        cv2.imshow(WindowName, temp)
        key = cv2.waitKey(1) & 0xFF
        if user_choice[0] is not None:
            # Restore mouse callback to default (None)
            cv2.setMouseCallback(WindowName, old_mouse_callback)
            return user_choice[0]
        if key == 27:
            cv2.setMouseCallback(WindowName, old_mouse_callback)
            return 'skip'
        keypress[0]=0
    # Fallback
    cv2.setMouseCallback(WindowName, old_mouse_callback)
    return 'skip'

def adjust_labels_interactively(
    img,
    label_lines,
    shift_pressed,
    scroll_delta,
    file_idx=None,
    total_files=None,
    filename=None,
    review_mode=["Both"],
    card_annotations=None,
):
    h, w, _ = img.shape
    if card_annotations is None:
        card_annotations = {
            "image": filename or "",
            "width": w,
            "height": h,
            "cards": [],
        }
    cards = card_annotations.setdefault("cards", [])
    zoom_width = 30
    step_size = 1
    idx = 0
    winWidth = int(1920*1.5)
    winHeight = int(winWidth*9.0/16.0)
    boundary_thickness = 5
    availWidth = winWidth-2*boundary_thickness
    availHeight = winHeight-boundary_thickness-boundary_thickness
    # Calculate max allowed width and height for left panel (75% of window)
    max_left_panel_width = int(availWidth)
    max_main_panel_height = int(availHeight * 0.75)
    
    new_bbox = False
    right_click = [False, False]
    keypoint_click = [None, False]
    def mouse_callback_rt_click(event, x, y, flags, param):
        if event == cv2.EVENT_RBUTTONDOWN:
            right_click[0] = True
            right_click[1] = shift_pressed[0]
        if event == cv2.EVENT_LBUTTONDOWN:
            keypoint_click[0] = (x, y)
            keypoint_click[1] = shift_pressed[0]
    cv2.namedWindow(WindowName, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
    cv2.setMouseCallback(WindowName, mouse_callback_rt_click)
    while idx < len(label_lines) or len(label_lines) == 0:
        if new_bbox:
            new_bbox = False
       
        mode_changed = False
        while not label_lines or len(label_lines) == 0:
            # Show UI with two buttons: Skip File or Create bounding box
            user_choice = show_no_detections_ui(img, filename, mouse_callback_rt_click)
            if user_choice == 'skip':
                break
            elif user_choice == 'create':
                # Use the shared inline bbox drawing function
                def set_mouse_callback(window, cb):
                    cv2.setMouseCallback(window, cb if cb else mouse_callback_rt_click)
                label_lines=[]
                created = draw_new_bbox_inline(img, WindowName, set_mouse_callback, label_lines, 0)
                if not created:
                    continue

        if not label_lines or len(label_lines) == 0:
            break
        tokens = label_lines[idx].split()
        if len(tokens) < 5:
            print("skipping label", idx)
            idx += 1
            continue
        # Retain keypoints (fields after the first 5)
        cls_id, x_c, y_c, bw, bh = map(float, tokens[:5])
        keypoints = tokens[5:]
        x1 = (x_c - bw/2) * w
        x2 = (x_c + bw/2) * w
        y1 = (y_c - bh/2) * h
        y2 = (y_c + bh/2) * h
        adj_x_left = x1
        adj_x_right = x2
        discard_bbox = False
        navigation = None
        # Determine which sides to review based on review_mode
        if review_mode[0] == "left":
            sides_to_review = ["left"]
        elif review_mode[0] == "right":
            sides_to_review = ["right"]
        else:
            sides_to_review = ["left", "right"]
        for current_side in sides_to_review:
            cv2.waitKey(1) # flush any extra keys
            right_click[0]=False
            adj_x = adj_x_left if current_side == "left" else adj_x_right
            while True:
                rect_thickness = 1
                vis = img.copy()
                draw_card_annotations(vis, cards, active_boat_index=idx)
                # Draw all bounding boxes in green, active in red on the context image only
                for i, line in enumerate(label_lines):
                    if i == idx:
                        continue  # Skip active, will draw below
                    try:
                        parts = line.split()
                        cls_id2, x_c2, y_c2, bw2, bh2 = map(float, parts[:5])
                        keypoints2 = parts[5:]
                        x1b = int((x_c2 - bw2/2) * w)
                        x2b = int((x_c2 + bw2/2) * w)
                        y1b = int((y_c2 - bh2/2) * h)
                        y2b = int((y_c2 + bh2/2) * h)
                        color = (0,0,255)
                        if (i < idx):
                            color = (255,0,255)
                        cv2.rectangle(vis, (x1b, y1b), (x2b, y2b), color, rect_thickness)
                        # Draw keypoints if present
                        if len(keypoints2) % 3 == 0 and len(keypoints2) > 0:
                            for kp in range(0, len(keypoints2), 3):
                                kpx = float(keypoints2[kp]) * w
                                kpy = float(keypoints2[kp+1]) * h
                                v = int(float(keypoints2[kp+2]))
                                kp_color = (0,255,255) if v > 0 else (128,128,128)
                                # Draw cross for keypoint
                                cx, cy = int(kpx), int(kpy)
                                size = 10
                                cv2.line(vis, (cx - size, cy), (cx + size, cy), kp_color, 2)
                                cv2.line(vis, (cx, cy - size), (cx, cy + size), kp_color, 2)
                    except Exception:
                        pass
                # Draw the original bbox in yellow
                x1r, x2r = int(round(adj_x_left)), int(round(adj_x_right))
                y1r, y2r = int(round(y1)), int(round(y2))

                # Ensure box is visible (not collapsed)
                if abs(x2r - x1r) > 1 and abs(y2r - y1r) > 1:
                    cv2.rectangle(vis, (x1r, y1r), (x2r, y2r), (0,255,255), rect_thickness)

                # Now draw the adjsuted bbox in red
                if current_side == "left":
                    x1r = int(round(adj_x))
                else:
                    x2r = int(round(adj_x))
                # Ensure box is visible (not collapsed)
                if abs(x2r - x1r) > 1 and abs(y2r - y1r) > 1:
                    # Draw semitransparent green border for adjusted bbox
                    overlay = np.zeros_like(vis)
                    cv2.rectangle(overlay, (x1r, y1r), (x2r, y2r), (0,255,0), 2*rect_thickness)
                    mask = np.any(overlay != 0, axis=2)
                    alpha = 0.3
                    vis[mask] = (alpha * overlay[mask] + (1 - alpha) * vis[mask]).astype(np.uint8)
                    # Draw a vertical red line at the current adj_x position
                    x_line = int(round(adj_x))
                    cv2.line(vis, (x_line, 0), (x_line, h-1), (0,255,0), 1)
                    # Draw keypoints for the active bbox if present
                    if len(keypoints) % 3 == 0 and len(keypoints) > 0:
                        for kp in range(0, len(keypoints), 3):
                            kpx = float(keypoints[kp]) * w
                            kpy = float(keypoints[kp+1]) * h
                            v = int(float(keypoints[kp+2]))
                            kp_color = (0,255,0) if v > 0 else (128,128,128)
                            # Draw cross for keypoint
                            cx, cy = int(kpx), int(kpy)
                            size = 10
                            cv2.line(vis, (cx - size, cy), (cx + size, cy), kp_color, 2)
                            cv2.line(vis, (cx, cy - size), (cx, cy + size), kp_color, 2)

                # Overlay filename and file count at the bottom of the combined image
                fname = filename if filename is not None else 'Image'
                if file_idx is not None and total_files is not None:
                    overlay_text = f"File {file_idx}/{total_files}  |  {fname}  |  Review Mode: {review_mode[0]} (b/l/r to change)"
                else:
                    overlay_text = fname
                
                zoom_img = img.copy()
                half_width = zoom_width / 2
                crop_x1 = int(round(adj_x - half_width))
                crop_x2 = int(round(adj_x + half_width))
                box_height = y2 - y1
                y2_extended = int(round(min(h, y2 + box_height * 0.2)))
                crop_y1 = int(round(y1))
                crop_y2 = y2_extended
                # Calculate padding if crop_x1 or crop_x2 are out of bounds
                pad_left = max(0, -crop_x1)
                pad_right = max(0, crop_x2 - w)
                crop_x1_clamped = max(0, crop_x1)
                crop_x2_clamped = min(w, crop_x2)
                crop = zoom_img[crop_y1:crop_y2, crop_x1_clamped:crop_x2_clamped]
                # Pad if needed to keep the edge centered
                if pad_left > 0 or pad_right > 0:
                    crop = cv2.copyMakeBorder(
                        crop,
                        0, 0, pad_left, pad_right,
                        cv2.BORDER_CONSTANT, value=(0,0,0)
                    )
                # If crop is empty, fallback to black
                if crop.size == 0:
                    crop = np.zeros((100, 100, 3), dtype=np.uint8)
                
                # Set up reference_image
                reference_image = resize_and_pad(vis, max_left_panel_width, max_main_panel_height)
                draw_text(reference_image, overlay_text, 0, max_main_panel_height-10)
                draw_card_blowup(reference_image, img, cards, idx)
                print_image_size("content_resized", reference_image)

                # --- BLOWUP OF BBOX (LIVE) ---
                bbox_crop = img[y1r:y2r, x1r:x2r]
                # If crop is empty, fallback to black
                if bbox_crop.size == 0 or (y2r-y1r)<=0 or (x2r-x1r)<=0:
                    bbox_crop = np.zeros((100, 100, 3), dtype=np.uint8)
                # Set up bbox_blowup
                max_blowup_width = int(max_left_panel_width*.75)
                max_blowup_height = int(availHeight - max_main_panel_height)
                bbox_blowup = resize_and_pad(bbox_crop, max_blowup_width, max_blowup_height, pad=30)
                label_text = f"Box {idx+1}/{len(label_lines)}  {current_side.upper()}  x={int(round(adj_x))}"
                
                # Draw keypoints on bbox_blowup
                if len(keypoints) % 3 == 0 and len(keypoints) > 0 and bbox_crop.shape[1] > 0 and bbox_crop.shape[0] > 0:
                    crop_h, crop_w = bbox_blowup.shape[:2]
                    orig_h, orig_w = bbox_crop.shape[:2]
                    scale = min((crop_w - 60) / orig_w, (crop_h - 60) / orig_h)  # pad=30
                    new_w = int(orig_w * scale)
                    new_h = int(orig_h * scale)
                    pad_x = (crop_w - new_w) // 2
                    pad_y = (crop_h - new_h) // 2
                    for kp in range(0, len(keypoints), 3):
                        kpx = float(keypoints[kp]) * w
                        kpy = float(keypoints[kp+1]) * h
                        v = int(float(keypoints[kp+2]))
                        # Map to bbox_crop
                        rel_x = (kpx - x1r) * new_w / (x2r - x1r) + pad_x if (x2r - x1r) > 0 else 0
                        rel_y = (kpy - y1r) * new_h / (y2r - y1r) + pad_y if (y2r - y1r) > 0 else 0
                        kp_color = (0,255,0) if v > 0 else (128,128,128)
                        # Draw cross for keypoint
                        cx, cy = int(rel_x), int(rel_y)
                        size = 10
                        cv2.line(bbox_blowup, (cx - size, cy), (cx + size, cy), kp_color, 2)
                        cv2.line(bbox_blowup, (cx, cy - size), (cx, cy + size), kp_color, 2)

                draw_text(bbox_blowup, label_text, 0,25)

                # minizoom = resize_and_pad(crop, max_left_panel_width-max_blowup_width, max_blowup_height)
                minizoom = resize_and_pad(crop, max_left_panel_width-max_blowup_width-boundary_thickness, max_blowup_height, align='fill', pad=20)
                
                center_x = minizoom.shape[1] // 2
                cv2.line(minizoom, (center_x, 0), (center_x, minizoom.shape[0]-1), (0,255,0), 2)
                # Draw keypoints on minizoom
                if len(keypoints) % 3 == 0 and len(keypoints) > 0 and crop.shape[1] > 0 and crop.shape[0] > 0:
                    zoom_h, zoom_w = minizoom.shape[:2]
                    crop_h, crop_w = crop.shape[:2]
                    for kp in range(0, len(keypoints), 3):
                        kpx = float(keypoints[kp]) * w
                        kpy = float(keypoints[kp+1]) * h
                        v = int(float(keypoints[kp+2]))
                        # Map to crop
                        rel_x = (kpx - (crop_x1_clamped - pad_left)) * zoom_w / crop_w if crop_w > 0 else 0
                        rel_y = (kpy - crop_y1) * zoom_h / crop_h if crop_h > 0 else 0
                        kp_color = (0,255,0) if v > 0 else (128,128,128)
                        # Draw cross for keypoint
                        cx, cy = int(rel_x), int(rel_y)
                        size = 10
                        cv2.line(minizoom, (cx - size, cy), (cx + size, cy), kp_color, 2)
                        cv2.line(minizoom, (cx, cy - size), (cx, cy + size), kp_color, 2)
                alpha = 0.2
                overlay = minizoom.copy()
                h_zoom, w_zoom = minizoom.shape[:2]
                if current_side == "left":
                    cv2.rectangle(overlay, (0, 0), (w_zoom//2, h_zoom), (0,0,0), -1)
                else:
                    cv2.rectangle(overlay, (w_zoom//2, 0), (w_zoom, h_zoom), (0,0,0), -1)
                minizoom = cv2.addWeighted(overlay, alpha, minizoom, 1 - alpha, 0)

                print_image_size("bbox crop", bbox_crop)
                print_image_size("bbox blowup 0", bbox_blowup)

                # Add a horizontal gray boundary (5px) between reference_image and bbox_blowup
                gray = (180, 180, 180)
                h_boundary = np.full((boundary_thickness, reference_image.shape[1], 3), gray, dtype=np.uint8)
                v_boundary = np.full((minizoom.shape[0], boundary_thickness, 3), gray, dtype=np.uint8)
                h_border = np.full((boundary_thickness, winWidth-2*boundary_thickness, 3), gray, dtype=np.uint8)
                v_border = np.full((winHeight, boundary_thickness, 3), gray, dtype=np.uint8)

                bottom_panel = np.hstack((bbox_blowup,v_boundary,minizoom))
                left_stack = np.vstack((reference_image, h_boundary, bottom_panel,h_border))
                combined = np.hstack((v_border,left_stack,v_border))
                print_image_size("main image", reference_image)
                print_image_size("bbox blowup final", bbox_blowup)
                print_image_size("left stack",left_stack)
                print_image_size("combined", combined)
                
                key = -1
                cv2.imshow(WindowName, combined)
                while key < 1 and not right_click[0] and scroll_delta[0] == 0  and keypress[0] == 0 and keypoint_click[0] is None:
                    key = cv2.waitKey(10)
                # Handle review mode switching
                if key in [ord('l'), ord('L')]:
                    review_mode[0] = "left"
                    mode_changed = True
                    break
                if key in [ord('r'), ord('R')]:
                    review_mode[0] = "right"
                    mode_changed = True
                    break
                if key in [ord('b'), ord('B')]:
                    review_mode[0] = "both"
                    mode_changed = True
                    break
                if key in [ord('n'), ord('N')]:
                    if not any(
                        card.get("boatIndex") == idx for card in cards
                    ):
                        if clear_reviewed_mismatch(card_annotations, idx):
                            print(
                                f"Cleared bowMismatch for boat {idx + 1} "
                                "with no saved card annotation"
                            )
                    navigation = "next"
                    break
                if key in [ord('p'), ord('P')]:
                    navigation = "previous"
                    break
                if key in [ord('c'), ord('C')]:
                    if shift_pressed[0]:
                        cards[:] = [
                            card
                            for card in cards
                            if card.get("boatIndex") != idx
                        ]
                        print(f"Removed bow-card annotation for boat {idx + 1}")
                        continue

                    current_x1 = int(round(
                        adj_x if current_side == "left" else adj_x_left
                    ))
                    current_x2 = int(round(
                        adj_x if current_side == "right" else adj_x_right
                    ))
                    current_y1 = int(round(y1))
                    current_y2 = int(round(y2))
                    boat_box = (
                        min(current_x1, current_x2),
                        min(current_y1, current_y2),
                        abs(current_x2 - current_x1),
                        abs(current_y2 - current_y1),
                    )
                    existing = next(
                        (
                            card
                            for card in cards
                            if card.get("boatIndex") == idx
                        ),
                        None,
                    )
                    labelled = label_card_for_boat(
                        img,
                        boat_box,
                        existing.get("value", "") if existing else "",
                    )
                    if labelled is not None:
                        card_box, value = labelled
                        annotation = make_card_annotation(
                            idx, boat_box, card_box, value, img.shape
                        )
                        mismatch_cleared = apply_manual_card_correction(
                            card_annotations, idx, annotation, existing
                        )
                        cards[:] = [
                            card
                            for card in cards
                            if card.get("boatIndex") != idx
                        ]
                        cards.append(annotation)
                        print(
                            f"Set bow card {value} for boat {idx + 1}: "
                            f"{card_box}"
                        )
                        if mismatch_cleared:
                            if annotation["legible"]:
                                print(
                                    "Cleared bowMismatch and updated "
                                    f"detectedBow to {annotation['value']}"
                                )
                            else:
                                print("Cleared bowMismatch for unreadable card")
                        navigation = "next"
                    cv2.setMouseCallback(WindowName, mouse_callback_rt_click)
                    if navigation:
                        break
                    continue
                if (key < 1 and keypress[0] != 0):
                    key = keypress[0]
                keypress[0]=0

                if key in [ord('v'), ord('V'), 'v', 'V'] or (
                    getattr(key, "char", "").lower() == 'v'
                ):
                    existing = next(
                        (
                            card
                            for card in cards
                            if card.get("boatIndex") == idx
                        ),
                        None,
                    )
                    if existing is None:
                        clear_reviewed_mismatch(card_annotations, idx)
                        print(
                            f"Verified boat {idx + 1} with no saved card "
                            "annotation; cleared bowMismatch"
                        )
                        navigation = "next"
                        break

                    existing["verified"] = True
                    clear_reviewed_mismatch(card_annotations, idx)
                    print(f"Verified bow card for boat {idx + 1}")
                    navigation = "next"
                    break

                if key in [ord('#'), '#'] or getattr(key, "char", None) == '#':
                    existing = next(
                        (
                            card
                            for card in cards
                            if card.get("boatIndex") == idx
                        ),
                        None,
                    )
                    if existing is None:
                        print(
                            f"Boat {idx + 1} has no saved card box; "
                            "press C to create one"
                        )
                        continue

                    value = relabel_existing_card(
                        img, existing, existing.get("value", "")
                    )
                    if value is None:
                        cv2.setMouseCallback(
                            WindowName, mouse_callback_rt_click
                        )
                        continue

                    existing_box = existing["box"]
                    card_box = (
                        existing_box["x"],
                        existing_box["y"],
                        existing_box["width"],
                        existing_box["height"],
                    )
                    current_x1 = int(round(
                        adj_x if current_side == "left" else adj_x_left
                    ))
                    current_x2 = int(round(
                        adj_x if current_side == "right" else adj_x_right
                    ))
                    boat_box = (
                        min(current_x1, current_x2),
                        int(round(min(y1, y2))),
                        abs(current_x2 - current_x1),
                        int(round(abs(y2 - y1))),
                    )
                    annotation = make_card_annotation(
                        idx, boat_box, card_box, value, img.shape
                    )
                    mismatch_cleared = apply_manual_card_correction(
                        card_annotations, idx, annotation, existing
                    )
                    cards[:] = [
                        card
                        for card in cards
                        if card.get("boatIndex") != idx
                    ]
                    cards.append(annotation)
                    print(
                        f"Updated bow card value to {value} for boat "
                        f"{idx + 1}; box unchanged"
                    )
                    if mismatch_cleared:
                        if annotation["legible"]:
                            print(
                                "Cleared bowMismatch and updated detectedBow "
                                f"to {annotation['value']}"
                            )
                        else:
                            print("Cleared bowMismatch for unreadable card")
                    cv2.setMouseCallback(WindowName, mouse_callback_rt_click)
                    navigation = "next"
                    break

                # Handle keypoint click
                if keypoint_click[0] is not None:
                    click_x, click_y = keypoint_click[0]
                    keypoint_click[0] = None
                    # Calculate bbox_blowup and minizoom panel positions in combined
                    # left_stack = np.vstack((reference_image, h_boundary, bottom_panel,h_border))
                    # combined = np.hstack((v_border,left_stack,v_border))
                    left_stack_height = reference_image.shape[0] + h_boundary.shape[0] + bottom_panel.shape[0] + h_border.shape[0]
                    left_stack_width = left_stack.shape[1]
                    v_border_width = v_border.shape[1]
                    # bottom_panel = np.hstack((bbox_blowup,v_boundary,minizoom))
                    bbox_blowup_width = bbox_blowup.shape[1]
                    minizoom_width = minizoom.shape[1]
                    bottom_panel_y0 = reference_image.shape[0] + h_boundary.shape[0]
                    bottom_panel_y1 = bottom_panel_y0 + bbox_blowup.shape[0]
                    bbox_blowup_x0 = v_border_width
                    bbox_blowup_x1 = v_border_width + bbox_blowup_width
                    minizoom_x0 = v_border_width + bbox_blowup_width + v_boundary.shape[1]
                    minizoom_x1 = minizoom_x0 + minizoom_width
                    # Check if click is in bbox_blowup
                    if (bbox_blowup_x0 <= click_x < bbox_blowup_x1 and
                        bottom_panel_y0 <= click_y < bottom_panel_y1):
                        # Map click to bbox_crop coordinates
                        rel_x = click_x - bbox_blowup_x0
                        rel_y = click_y - bottom_panel_y0
                        # Map to bbox_crop
                        crop_h, crop_w = bbox_blowup.shape[:2]
                        orig_h, orig_w = bbox_crop.shape[:2]
                        # Calculate padding added by resize_and_pad
                        scale = min((crop_w - 60) / orig_w, (crop_h - 60) / orig_h)  # pad=30
                        new_w = int(orig_w * scale)
                        new_h = int(orig_h * scale)
                        pad_x = (crop_w - new_w) // 2
                        pad_y = (crop_h - new_h) // 2
                        # Only process clicks inside the image area
                        if (pad_x <= rel_x < pad_x + new_w) and (pad_y <= rel_y < pad_y + new_h) and orig_w > 0 and orig_h > 0:
                            img_x = x1r + ((rel_x - pad_x) * (x2r - x1r) / new_w)
                            img_y = y1r + ((rel_y - pad_y) * (y2r - y1r) / new_h)
                            # If shift is pressed, remove keypoints for this bbox
                            if keypoint_click[1]:
                                keypoints.clear()
                                label_lines[idx] = f"{int(cls_id)} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}"
                                continue
                            # Update/add keypoint (normalized)
                            norm_x = img_x / w
                            norm_y = img_y / h
                            if len(keypoints) >= 3:
                                keypoints[0] = f"{norm_x:.6f}"
                                keypoints[1] = f"{norm_y:.6f}"
                                keypoints[2] = "2"
                            else:
                                keypoints[:] = [f"{norm_x:.6f}", f"{norm_y:.6f}", "2"]
                            # Update label line immediately
                            if keypoints:
                                label_lines[idx] = f"{int(cls_id)} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f} {' '.join(keypoints)}"
                            else:
                                label_lines[idx] = f"{int(cls_id)} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}"
                            continue
                    # Check if click is in minizoom
                    if (minizoom_x0 <= click_x < minizoom_x1 and
                        bottom_panel_y0 <= click_y < bottom_panel_y1):
                        rel_x = click_x - minizoom_x0
                        rel_y = click_y - bottom_panel_y0
                        zoom_h, zoom_w = minizoom.shape[:2]
                        # Map to crop
                        crop_h, crop_w = crop.shape[:2]
                        if crop_w > 0 and crop_h > 0:
                            crop_x = rel_x * crop_w / zoom_w
                            crop_y = rel_y * crop_h / zoom_h
                            # Map crop_x to image x
                            crop_x1_img = crop_x1_clamped - pad_left
                            img_x = crop_x1_img + crop_x
                            img_y = crop_y1 + crop_y
                            norm_x = img_x / w
                            norm_y = img_y / h
                            if len(keypoints) >= 3:
                                keypoints[0] = f"{norm_x:.6f}"
                                keypoints[1] = f"{norm_y:.6f}"
                                keypoints[2] = "2"
                            else:
                                keypoints[:] = [f"{norm_x:.6f}", f"{norm_y:.6f}", "2"]
                            if keypoints:
                                label_lines[idx] = f"{int(cls_id)} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f} {' '.join(keypoints)}"
                            else:
                                label_lines[idx] = f"{int(cls_id)} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}"
                            continue

                if right_click[0]:
                    break

                # Mouse wheel: move left/right if scrolledn
                if scroll_delta[0] != 0:
                    move = step_size * 10 if shift_pressed[0] else step_size
                    adj_x += move * scroll_delta[0]
                    # Clamp to bounds
                    if current_side == "left":
                        adj_x = min(max(adj_x, 0), x2 - step_size)
                    else:
                        adj_x = min(max(adj_x, x1 + step_size), w)
                    adj_x = min(max(adj_x, 0), w)
                    scroll_delta[0] = 0
                    continue

                if key in [27, ord('q'), 'q', keyboard.Key.esc]:
                    print("Exiting.")
                    exit(0)
                elif key in [13,10,32, keyboard.Key.enter, ' ']:
                    break # save and next
                elif key in [ ord('+'), '+']:
                    def set_mouse_callback(window, cb):
                        cv2.setMouseCallback(window, cb if cb else mouse_callback_rt_click)
                    new_bbox = draw_new_bbox_inline(img, WindowName, set_mouse_callback, label_lines, idx)
                    if new_bbox:
                        for card in cards:
                            if card.get("boatIndex", -1) >= idx:
                                card["boatIndex"] += 1
                        break
                    continue
                elif key in [127, 3014656, 8, keyboard.Key.backspace, keyboard.Key.delete]:  # Delete/backspace key
                    if (current_side == "right"):
                        current_side = sides_to_review[0]
                        adj_x = adj_x_left if current_side == "left" else adj_x_right
                        continue
                    elif idx > 0:
                        idx-=1
                        new_bbox=True
                        break
                    else:
                        return 'go_back', review_mode, card_annotations
                elif key in [ord('x')]:
                    # Remove current bbox from label_lines
                    del label_lines[idx]
                    cards[:] = [
                        card
                        for card in cards
                        if card.get("boatIndex") != idx
                    ]
                    for card in cards:
                        if card.get("boatIndex", -1) > idx:
                            card["boatIndex"] -= 1
                    discard_bbox = True
                    break
                elif key in [ord('X')]:
                    # Remove current bbox from label_lines
                    label_lines=label_lines[:idx]
                    cards[:] = [
                        card
                        for card in cards
                        if card.get("boatIndex", -1) < idx
                    ]
                    discard_bbox = True
                    break
                elif key in [keyboard.Key.left, 81, 2, 0x20, 0x100, 65308, 65430, 2424832]:
                    # Left arrow
                    move = step_size * 10 if shift_pressed[0] else step_size
                    if current_side == "left":
                        adj_x = max(0, adj_x - move)
                    else:
                        adj_x = max(x1 + step_size, adj_x - move)
                    # Clamp to image bounds
                    adj_x = min(max(adj_x, 0), w)
                    continue
                elif key in [keyboard.Key.right, 83, 3, 0x21, 0x101, 65363, 65432, 2555904]:
                    # Right arrow
                    move = step_size * 10 if shift_pressed[0] else step_size
                    if current_side == "left":
                        adj_x = min(x2 - step_size, adj_x + move)
                    else:
                        adj_x = min(w, adj_x + move)
                    # Clamp to image bounds
                    adj_x = min(max(adj_x, 0), w)
                    continue
                elif key in [ord('u'), keyboard.Key.up, 0, 44, 82, 0x26, 65362, 1113938, 2490368]:
                    # Up arrow
                    move = step_size * 10 if shift_pressed[0] else step_size
                    if current_side == "left":
                        y1 = max(0, y1 - move)
                    else:
                        y2 = max(y1 + step_size, y2 - move)
                    y1 = min(max(y1, 0), h)
                    y2 = min(max(y2, 0), h)
                    continue
                elif key in [ord('d'), keyboard.Key.down, 1, 45, 84, 0x28, 65364, 1113954, 2621440]:
                    # Down arrow
                    move = step_size * 10 if shift_pressed[0] else step_size
                    if current_side == "left":
                        y1 = min(y2 - step_size, y1 + move)
                    else:
                        y2 = min(h, y2 + move)
                    y1 = min(max(y1, 0), h)
                    y2 = min(max(y2, 0), h)
                    continue

            # if new_bbox:
            #     break
            if discard_bbox:
                break

            if new_bbox:
                current_side = sides_to_review[0]
                break
            
            # Update tracking values
            if current_side == "left":
                adj_x_left = adj_x
            else:
                adj_x_right = adj_x

            if navigation:
                break

            if mode_changed:
                break
                
        if new_bbox or discard_bbox:
            continue # do not increment or save

        final_x1 = adj_x_left
        final_x2 = adj_x_right
        new_x_c = (final_x1 + final_x2)/2 / w
        new_bw  = (final_x2 - final_x1)/w
        new_y_c = (y1 + y2)/2 / h
        new_bh  = (y2 - y1)/h
        final_boat_box = {
            "x": int(round(min(final_x1, final_x2))),
            "y": int(round(min(y1, y2))),
            "width": int(round(abs(final_x2 - final_x1))),
            "height": int(round(abs(y2 - y1))),
        }
        for card in cards:
            if card.get("boatIndex") == idx:
                card["boatBox"] = final_boat_box
        # Retain keypoints in the output line
        if keypoints:
            new_line = f"{int(cls_id)} {new_x_c:.6f} {new_y_c:.6f} {new_bw:.6f} {new_bh:.6f} {' '.join(keypoints)}"
        else:
            new_line = f"{int(cls_id)} {new_x_c:.6f} {new_y_c:.6f} {new_bw:.6f} {new_bh:.6f}"
        label_lines[idx]=new_line

        if navigation == "previous":
            idx = max(0, idx - 1)
            continue

        if mode_changed:
            continue
        idx += 1
        
    return label_lines, review_mode, card_annotations

IMAGE_SUFFIXES = ['.jpg', '.jpeg', '.png']

def find_image(image_dir, name):
    """Resolve --image as a path, or as a file name or stem inside image_dir."""
    path = Path(name)
    if path.is_file():
        return path
    if (image_dir / path.name).is_file():
        return image_dir / path.name
    for suffix in IMAGE_SUFFIXES:
        candidate = image_dir / (path.name + suffix)
        if candidate.is_file():
            return candidate
    return None

def main():
    parser = argparse.ArgumentParser(
        description="Create and adjust YOLO labels using model detections and interactive review.",
        epilog="""
BBox Keyboard Actions:
  Left/Right Arrow: Move x1/x2 (left/right edge) of the bbox
  Up/Down Arrow, 'u','d': Move y1/y2 (top/bottom edge) of the bbox
  Shift + Arrow: Move edge by 10 pixels
  Mouse Wheel: Move x1/x2 (left/right edge) of the bbox
  Shift + Mouse Wheel: Move edge by 10 pixels
  + : Add a new bounding box
  x : Remove current bounding box
  X : Remove all bounding boxes after current
  Delete/Backspace: Go back or delete current
  Enter/Space or Right Mouse Button: Accept current adjustment

Keypoint Labeling:
  Left Click: Assign Bow keypoint location.  Shift to remove (may require restart with --skip)
  Right Click: Move to the next bbox
  C : Draw or replace the active boat's bow-card bbox and enter its value
      Enter ? as the value when the physical card is present but unreadable
  # : Change the active boat's bow value without changing its card bbox
  V : Verify the active card, clear detected digits/mismatch, and advance
  Shift+C : Remove the active boat's bow-card annotation
  N : Save the current adjustments and advance to the next boat
  P : Save the current adjustments and return to the previous boat
  L : Preview only the left edge of the bbox
  R : Preview only the right edge of the bbox
  B : Preview both edges of the bbox

Exit:
  q or ESC: Quit

--zip: Zip all files in the labels folder and exit
""",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--images', default='images', help='Folder containing images. Default: images')
    parser.add_argument('--model', default='https://storage.googleapis.com/training.crewtimer.com/models/crewtimer-boat-train.onnx', help='Path to YOLO model file (.pt/.onnx). Default: download')
    parser.add_argument('--labels', default='labels', help='Folder to save output YOLO label files.  Default: labels')
    parser.add_argument(
        '--card-labels',
        default='card-labels',
        help='Folder for bow-card JSON sidecars. Default: card-labels',
    )
    parser.add_argument(
        '--skip-card-labeled',
        action='store_true',
        help='Skip images whose card sidecar already contains a bow card',
    )
    parser.add_argument(
        '--only-mismatch',
        action='store_true',
        help='Only review images whose card sidecar has bowMismatch=true',
    )
    parser.add_argument(
        '--only-multiple-boats',
        action='store_true',
        help='Only review images whose YOLO label file has more than one boat box',
    )
    parser.add_argument('--all', action='store_true', help='Process all images, even if a label file already exists')
    parser.add_argument('--ignore-labels', action='store_true', help='Always run the model to create bboxes, ignoring existing label files')
    parser.add_argument('--skip', type=int, default=0, help='Skip the first N files')
    parser.add_argument(
        '--image',
        help='Review only this image (a path, or a file name or stem in --images), even if already labeled',
    )
    parser.add_argument('--zip', action='store_true', help='Zip all files in the labels folder into dirname.zip and exit')
    args = parser.parse_args()

    if getattr(args, 'zip', False):
        import zipfile
        import os
        label_dir = args.labels
        abs_label_dir = os.path.abspath(label_dir)
        parent_dir = os.path.basename(os.path.dirname(abs_label_dir))
        label_dir_name = os.path.basename(abs_label_dir)
        zip_name = f"{parent_dir}-{label_dir_name}.zip"
        with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(label_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, label_dir)
                    zipf.write(file_path, arcname)
        print(f"Zipped all files in '{label_dir}' to '{zip_name}'")
        return

    import os, urllib.request
    os.makedirs(args.labels, exist_ok=True)
    os.makedirs(args.card_labels, exist_ok=True)
    model_path = args.model
    if model_path.startswith('http'):
        filename = os.path.basename(model_path)
        current_model_path = Path.cwd() / filename
        parent_model_path = Path.cwd().parent / filename
        if current_model_path.is_file():
            model_path = current_model_path
        elif parent_model_path.is_file():
            model_path = parent_model_path
        else:
            print(
                f"Downloading model from {model_path} to "
                f"{parent_model_path}..."
            )
            urllib.request.urlretrieve(model_path, parent_model_path)
            model_path = parent_model_path
    model = load_model(model_path)
    image_dir = Path(args.images)
    if args.image:
        image_path = find_image(image_dir, args.image)
        if image_path is None:
            print(f"Image not found: {args.image}")
            return
        image_files = [image_path]
    else:
        image_files = sorted([f for f in image_dir.iterdir() if f.suffix.lower() in IMAGE_SUFFIXES])
    if args.only_mismatch and not args.image:
        image_files = [
            image_path
            for image_path in image_files
            if has_bow_mismatch(
                os.path.join(args.card_labels, image_path.stem + ".json")
            )
        ]
        print(f"Found {len(image_files)} image(s) flagged with bowMismatch=true")
    if args.only_multiple_boats and not args.image:
        image_files = [
            image_path
            for image_path in image_files
            if has_multiple_boat_boxes(
                os.path.join(args.labels, image_path.stem + ".txt")
            )
        ]
        print(f"Found {len(image_files)} image(s) with multiple boat boxes")
    if not image_files:
        if args.only_mismatch and args.only_multiple_boats:
            print("No bow-mismatch images with multiple boat boxes found.")
        elif args.only_mismatch:
            print("No bow-mismatch images found.")
        elif args.only_multiple_boats:
            print("No images with multiple boat boxes found.")
        else:
            print("No images found in the specified folder.")
        return

    # Set up shift key and mouse wheel listeners once for the whole session
    shift_pressed = [False]
    scroll_delta = [0]
    def on_press(key):
        keypress[0]=key
        try:
            if key == keyboard.Key.shift or key == keyboard.Key.shift_r or key == keyboard.Key.shift_l:
                shift_pressed[0] = True
        except Exception:
            pass
    def on_release(key):
        try:
            if key == keyboard.Key.shift or key == keyboard.Key.shift_r or key == keyboard.Key.shift_l:
                shift_pressed[0] = False
        except Exception:
            pass

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.start()
    def on_scroll(x, y, dx, dy):
        scroll_delta[0] += dy
    mouse_listener = mouse.Listener(on_scroll=on_scroll)
    mouse_listener.start()

    idx = 0 if args.image else args.skip
    total_files = len(image_files)
    review_mode = ["Both"]
    while idx < total_files:
        img_path = image_files[idx]
        label_filename = img_path.stem + ".txt"
        out_path = os.path.join(args.labels, label_filename)
        card_path = os.path.join(args.card_labels, img_path.stem + ".json")
        if (
            args.skip_card_labeled
            and not args.image
            and has_card_annotations(card_path)
        ):
            print(f"Skipping card-labeled image: {img_path.name}")
            idx += 1
            continue
        if (
            not args.all
            and not args.image
            and not args.only_mismatch
            and not args.only_multiple_boats
            and os.path.exists(out_path)
        ):
            idx += 1
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"Failed to load image: {img_path}")
            idx += 1
            continue
        if not args.ignore_labels and os.path.exists(out_path):
            print(f"Reviewing existing labels for {img_path.name}")
            with open(out_path, "r") as f:
                yolo_labels = [line.strip() for line in f if line.strip()]
        else:
            results = run_detection(model, str(img_path))
            yolo_labels = detections_to_yolo(results, img.shape)

        card_annotations = load_card_annotations(
            card_path, img_path, img.shape
        )
        
        print(f"Reviewing detections for {img_path.name}")
        adjusted_labels, review_mode, card_annotations = adjust_labels_interactively(
            img, yolo_labels, shift_pressed, scroll_delta,
            file_idx=idx+1, total_files=total_files, filename=img_path.name,
            review_mode=review_mode, card_annotations=card_annotations)
        if adjusted_labels == 'go_back':
            save_card_annotations(card_path, card_annotations)
            if idx > 0:
                idx -= 1
            else:
                print("Already at the first file, cannot go back further.")
            continue
        with open(out_path, "w") as out_f:
            out_f.write("\n".join(adjusted_labels))
        save_card_annotations(card_path, card_annotations)
        idx += 1
    listener.stop()
    mouse_listener.stop()
    print("Done creating and adjusting labels.")
    cv2.destroyAllWindows()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting on Control-C")
        import sys
        sys.exit(0)
