# VÉRTICE Redmi 9A profile.
# Base: Android 10 legacy GSI, ARM32 userspace / Binder64 / A-B / SAR.
# This profile is experimental and requires a matching Treble/VNDK vendor.
#
# The CI injects base_redmi9a.mk after verifying the exact upstream branch layout.

$(call inherit-product, device/vertice/gsi/base_redmi9a.mk)
$(call inherit-product, device/vertice/gsi/vertice_gsi.mk)

PRODUCT_NAME := vertice_redmi9a
# Keep the upstream legacy-GSI board configuration; only the product name is custom.
PRODUCT_DEVICE := generic_arm_64b_ab
PRODUCT_BRAND := VERTICE
PRODUCT_MODEL := VÉRTICE GSI — Redmi 9A ARM32/Binder64
