SHELL := /bin/bash

PYTHON ?= python3
RAW_DATA_ROOT ?= /Users/glenne/training/datasets
BUILD_DIR ?= build
VALIDATION_PERCENT ?= 20

CARD_DATA_DIR := $(BUILD_DIR)/card-detector-data
CARD_RUN_DIR := $(BUILD_DIR)/card-detector-run
OCR_DATA_DIR := $(BUILD_DIR)/ocr-data

CARD_BASE_MODEL ?= yolov8s.pt
CARD_EPOCHS ?= 100
CARD_PATIENCE ?= 15
CARD_BATCH ?= 16
CARD_DEVICE ?= cpu

OCR_EPOCHS ?= 30
OCR_SAMPLES ?= 5000
OCR_REAL_FRACTION ?= 0.60

LABEL_FILES := $(wildcard $(RAW_DATA_ROOT)/*/card-labels/*.json)
LABEL_DIRS := $(sort $(dir $(LABEL_FILES)))
DATASETS := $(patsubst %/card-labels/,%,$(LABEL_DIRS))

.PHONY: help all data card-data ocr-data card ocr verify test clean

help:
	@echo "Bow detection model training"
	@echo
	@echo "  make all       Regenerate datasets, train both models, and test"
	@echo "  make data      Regenerate card-detector and OCR datasets"
	@echo "  make card      Train/export bow_card_detect.onnx"
	@echo "  make ocr       Train/export bow_crnn.onnx"
	@echo "  make verify    Validate ONNX files and run end-to-end tests"
	@echo "  make clean     Remove generated datasets and training runs"
	@echo
	@echo "Common overrides:"
	@echo "  RAW_DATA_ROOT=/path/to/datasets CARD_DEVICE=mps"
	@echo "  CARD_EPOCHS=100 OCR_EPOCHS=30 OCR_REAL_FRACTION=0.60"

all: card ocr
	$(MAKE) verify

data: card-data ocr-data

card-data:
	@test -n "$(DATASETS)" || { echo "No card-labels JSON found under $(RAW_DATA_ROOT)"; exit 1; }
	rm -rf "$(CARD_DATA_DIR)"
	$(PYTHON) build_card_detector_dataset.py $(DATASETS) \
		--output "$(CARD_DATA_DIR)" \
		--validation-percent "$(VALIDATION_PERCENT)"

ocr-data:
	@test -n "$(DATASETS)" || { echo "No card-labels JSON found under $(RAW_DATA_ROOT)"; exit 1; }
	rm -rf "$(OCR_DATA_DIR)"
	$(PYTHON) extract_card_training_crops.py $(DATASETS) \
		--output "$(OCR_DATA_DIR)" \
		--validation-percent "$(VALIDATION_PERCENT)"
	cp training_crops/*.png "$(OCR_DATA_DIR)/train/"

card: card-data
	rm -rf "$(CARD_RUN_DIR)"
	yolo detect train \
		model="$(CARD_BASE_MODEL)" data="$(CARD_DATA_DIR)/data.yaml" \
		epochs="$(CARD_EPOCHS)" patience="$(CARD_PATIENCE)" \
		batch="$(CARD_BATCH)" imgsz=640 device="$(CARD_DEVICE)" \
		workers=0 project="$(abspath $(CARD_RUN_DIR))" name=train seed=0 deterministic=True
	yolo export model="$(CARD_RUN_DIR)/train/weights/best.pt" \
		format=onnx imgsz=640 opset=17 simplify=True dynamic=False
	cp "$(CARD_RUN_DIR)/train/weights/best.onnx" bow_card_detect.onnx

ocr: ocr-data
	$(PYTHON) train_bow_crnn.py \
		--epochs "$(OCR_EPOCHS)" --samples "$(OCR_SAMPLES)" \
		--real-fraction "$(OCR_REAL_FRACTION)" \
		--real-data "$(OCR_DATA_DIR)/train" \
		--output bow_crnn.onnx

verify:
	$(PYTHON) -c "import onnxruntime as ort; [ort.InferenceSession(path, providers=['CPUExecutionProvider']) for path in ('crewtimer-boat-train.onnx', 'bow_card_detect.onnx', 'bow_crnn.onnx')]; print('All ONNX models load successfully')"
	$(PYTHON) train_bow_crnn.py --verify bow_crnn.onnx
	$(PYTHON) -m unittest test_boat_card_detection_test.py -v

test: verify

clean:
	rm -rf "$(BUILD_DIR)"
