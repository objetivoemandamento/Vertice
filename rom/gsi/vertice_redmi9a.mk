# VÉRTICE Redmi 9A profile.
# Base: Android 10 legacy GSI, ARM32 userspace / Binder64 / A-B / SAR.
# This profile is experimental and requires a matching Treble/VNDK vendor.

$(call inherit-product, $(SRC_TARGET_DIR)/product/aosp_arm_64b_ab.mk)
$(call inherit-product, device/vertice/gsi/vertice_gsi.mk)

PRODUCT_NAME := vertice_redmi9a
PRODUCT_DEVICE := vertice_redmi9a
PRODUCT_BRAND := VERTICE
PRODUCT_MODEL := VÉRTICE GSI — Redmi 9A ARM32/Binder64
