SHELL := /bin/bash

PYTHON ?= python3
RAW_DATA_ROOT ?= /Users/glenne/training/datasets
BUILD_DIR ?= build
SCRIPTS_DIR := scripts
TEST_DIR := test
HOLDOUT_DATASET ?= $(HOME)/training/datasets/dataset-holdout
HOLDOUT_OUTPUT ?= $(BUILD_DIR)/holdout-validation
HOLDOUT_IOU ?= 0.5
HOLDOUT_LAST_DIGIT_ONLY ?= 0
HOLDOUT_LAST_DIGIT_ARG := $(if $(filter 1 true yes,$(HOLDOUT_LAST_DIGIT_ONLY)),--last-digit-only,)

# Reuse the review app's native libraries and pipeline. Override these flags
# when using libraries installed elsewhere (defaults match its macOS build).
FFREADER_SRC := ../ffreader/src
OPENCV_ROOT ?= ../ffreader/lib-build/opencv-static-mac
ORT_ROOT ?= ../ffreader/lib-build/onnxruntime-static-mac
HOLDOUT_CPPFLAGS ?= -I$(FFREADER_SRC) -I$(OPENCV_ROOT)/include/opencv5 -I$(ORT_ROOT)/include
HOLDOUT_LDLIBS ?= $(OPENCV_ROOT)/lib/libopencv_imgproc.a $(OPENCV_ROOT)/lib/libopencv_core.a \
	$(wildcard $(OPENCV_ROOT)/lib/opencv5/3rdparty/*.a) \
	$(ORT_ROOT)/lib/libonnxruntime.1.dylib -Wl,-rpath,$(abspath $(ORT_ROOT)/lib) \
	-framework Accelerate -framework Foundation -framework OpenCL
HOLDOUT_SOURCES := holdout_pipeline.cpp $(addprefix $(FFREADER_SRC)/,BowNumberPipeline.cpp BowNumberReader.cpp YoloBoxDetector.cpp OrtSessionUtils.cpp)
HOLDOUT_HEADERS := $(addprefix $(FFREADER_SRC)/,BowNumberPipeline.hpp BowNumberReader.hpp YoloBoxDetector.hpp OrtSessionUtils.hpp)
VALIDATION_PERCENT ?= 20

CARD_DATA_DIR := $(BUILD_DIR)/card-detector-data
CARD_RUN_DIR := $(BUILD_DIR)/card-detector-run
OCR_DATA_DIR := $(BUILD_DIR)/ocr-data

CARD_BASE_MODEL ?= yolov8s.pt
CARD_EPOCHS ?= 100
CARD_PATIENCE ?= 15
CARD_BATCH ?= 16
CARD_DEVICE ?= $(shell $(PYTHON) -c "import torch; print('mps' if torch.backends.mps.is_available() else 'cpu')" 2>/dev/null || echo cpu)

OCR_EPOCHS ?= 50
OCR_PATIENCE ?= 15
OCR_SAMPLES ?= 5000
OCR_REAL_FRACTION ?= 0.60
OCR_REAL_ALPHA_FRACTION ?= 0.10
OCR_ALPHA_PREFIX_FRACTION ?= 0.80

LABEL_FILES := $(wildcard $(RAW_DATA_ROOT)/*/card-labels/*.json)
LABEL_DIRS := $(sort $(dir $(LABEL_FILES)))
DATASETS := $(filter-out $(RAW_DATA_ROOT)/holdout $(RAW_DATA_ROOT)/dataset-holdout $(HOLDOUT_DATASET),$(patsubst %/card-labels/,%,$(LABEL_DIRS)))

.PHONY: help all data card-data ocr-data card ocr colab-all-zip upload-all-zip verify test clean validate-holdout

help:
	@echo "Bow detection model training"
	@echo
	@echo "  make all       Regenerate datasets, train all three models, and test"
	@echo "  make data      Regenerate card-detector and OCR datasets"
	@echo "  make card      Train/export bow_card_detect.onnx"
	@echo "  make ocr       Train/export alphanumeric and numeric bow_crnn ONNX models"
	@echo "  make update-colab-notebook Update Colab notebook in Google Drive"
	@echo "  make colab-all-zip Package card-detector and OCR data for Colab"
	@echo "  make upload-all-zip Copy Colab zip to Google Drive"
	@echo "  make verify    Validate ONNX files and run end-to-end tests"
	@echo "  make validate-holdout Validate holdout images with the review app pipeline; write Markdown/JSON reports"
	@echo "  make clean     Remove generated datasets and training runs"
	@echo
	@echo "Common overrides:"
	@echo "  RAW_DATA_ROOT=/path/to/datasets CARD_DEVICE=cpu"
	@echo "  CARD_EPOCHS=100 OCR_EPOCHS=50 OCR_REAL_FRACTION=0.60 OCR_ALPHA_PREFIX_FRACTION=0.80"
	@echo "  HOLDOUT_LAST_DIGIT_ONLY=1 validates only the final digit of each bow label"

all: card ocr
	$(MAKE) verify

data: card-data ocr-data

card-data:
	@test -n "$(DATASETS)" || { echo "No card-labels JSON found under $(RAW_DATA_ROOT)"; exit 1; }
	rm -rf "$(CARD_DATA_DIR)"
	$(PYTHON) $(SCRIPTS_DIR)/build_card_detector_dataset.py $(DATASETS) \
		--output "$(CARD_DATA_DIR)" \
		--validation-percent "$(VALIDATION_PERCENT)"

ocr-data:
	@test -n "$(DATASETS)" || { echo "No card-labels JSON found under $(RAW_DATA_ROOT)"; exit 1; }
	rm -rf "$(OCR_DATA_DIR)"
	$(PYTHON) $(SCRIPTS_DIR)/extract_card_training_crops.py $(DATASETS) \
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
	$(PYTHON) $(SCRIPTS_DIR)/train_bow_crnn.py \
		--epochs "$(OCR_EPOCHS)" --patience "$(OCR_PATIENCE)" \
		--samples "$(OCR_SAMPLES)" \
		--real-fraction "$(OCR_REAL_FRACTION)" \
		--real-alpha-fraction "$(OCR_REAL_ALPHA_FRACTION)" \
		--alpha-prefix-fraction "$(OCR_ALPHA_PREFIX_FRACTION)" \
		--real-data "$(OCR_DATA_DIR)/train" \
		--validation-data "$(OCR_DATA_DIR)/validation" \
		--output bow_crnn.onnx
	$(PYTHON) $(SCRIPTS_DIR)/train_bow_crnn.py \
		--vocabulary numeric \
		--epochs "$(OCR_EPOCHS)" --patience "$(OCR_PATIENCE)" \
		--samples "$(OCR_SAMPLES)" \
		--real-fraction "$(OCR_REAL_FRACTION)" \
		--real-data "$(OCR_DATA_DIR)/train" \
		--validation-data "$(OCR_DATA_DIR)/validation" \
		--output bow_crnn_numeric.onnx

colab-all-zip: data
	$(PYTHON) $(SCRIPTS_DIR)/package_bow_training_dataset.py \
		--card-dataset "$(CARD_DATA_DIR)" \
		--ocr-dataset "$(OCR_DATA_DIR)" \
		--output "$(BUILD_DIR)/bow-training-colab.zip"

upload-all-zip: $(BUILD_DIR)/bow-training-colab.zip
	@echo "Upload $(BUILD_DIR)/bow-training-colab.zip to Colab or Google Drive"
	cp "$(BUILD_DIR)/bow-training-colab.zip" "$(HOME)/Library/CloudStorage/GoogleDrive-glenne@engel.org/My Drive/yolo_training/data"
	@echo "Done!"

update-colab-notebook: train_bow_models_colab.ipynb
	cp train_bow_models_colab.ipynb "$(HOME)/Library/CloudStorage/GoogleDrive-glenne@engel.org/My Drive/Colab Notebooks"
	cp CrewTimer-Boat-Training.ipynb "$(HOME)/Library/CloudStorage/GoogleDrive-glenne@engel.org/My Drive/Colab Notebooks"


verify:
	$(PYTHON) -c "import onnxruntime as ort; [ort.InferenceSession(path, providers=['CPUExecutionProvider']) for path in ('crewtimer-boat-train.onnx', 'bow_card_detect.onnx', 'bow_crnn.onnx', 'bow_crnn_numeric.onnx')]; print('All ONNX models load successfully')"
	$(PYTHON) $(SCRIPTS_DIR)/train_bow_crnn.py --verify bow_crnn.onnx \
		--validation-data "$(OCR_DATA_DIR)/validation" \
		--min-real-accuracy 0.85
	$(PYTHON) $(SCRIPTS_DIR)/train_bow_crnn.py --vocabulary numeric \
		--verify bow_crnn_numeric.onnx \
		--validation-data "$(OCR_DATA_DIR)/validation" \
		--min-real-accuracy 0.85
	PYTHONPATH=$(SCRIPTS_DIR) $(PYTHON) -m unittest discover -s $(TEST_DIR) -p '*_test.py' -v

test: verify

clean:
	rm -rf "$(BUILD_DIR)"

# No training prerequisite: evaluate the current application models as-is.
validate-holdout: $(BUILD_DIR)/holdout-pipeline
	$(PYTHON) $(SCRIPTS_DIR)/validate_holdout.py --dataset "$(HOLDOUT_DATASET)" \
		--output-dir "$(HOLDOUT_OUTPUT)" --iou "$(HOLDOUT_IOU)" \
		--runner "$(BUILD_DIR)/holdout-pipeline" $(HOLDOUT_LAST_DIGIT_ARG)

$(BUILD_DIR)/holdout-pipeline: $(HOLDOUT_SOURCES) $(HOLDOUT_HEADERS) Makefile
	mkdir -p "$(BUILD_DIR)"
	$(CXX) $(CPPFLAGS) $(HOLDOUT_CPPFLAGS) $(CXXFLAGS) -std=c++17 -O2 \
		$(HOLDOUT_SOURCES) $(LDFLAGS) $(HOLDOUT_LDLIBS) -o "$@"
