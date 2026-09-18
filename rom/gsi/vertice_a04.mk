# VÉRTICE Galaxy A04 profile.
# Base: Android 12 GSI, ARM64 userspace / Binder64 / system-as-root.
#
# The CI injects base_a04.mk after verifying the exact upstream branch layout.

$(call inherit-product, device/vertice/gsi/base_a04.mk)
$(call inherit-product, device/vertice/gsi/vertice_gsi.mk)

PRODUCT_NAME := vertice_a04
# Keep the upstream GSI board configuration; only the product name is custom.
PRODUCT_DEVICE := gsi_arm64
PRODUCT_BRAND := VERTICE
PRODUCT_MODEL := VÉRTICE GSI — Galaxy A04 ARM64
