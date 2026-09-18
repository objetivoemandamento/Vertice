# VÉRTICE Galaxy A04 profile.
# Base: Android 12 GSI, ARM64 userspace / Binder64 / system-as-root.

$(call inherit-product, $(SRC_TARGET_DIR)/product/gsi_arm64.mk)
$(call inherit-product, device/vertice/gsi/vertice_gsi.mk)

PRODUCT_NAME := vertice_a04
PRODUCT_DEVICE := vertice_a04
PRODUCT_BRAND := VERTICE
PRODUCT_MODEL := VÉRTICE GSI — Galaxy A04 ARM64
