# Shared VÉRTICE launcher/low-RAM integration.
#
# This is intentionally a product fragment. It is inherited by a VÉRTICE
# product overlay and never appended to an upstream AOSP target file.

PRODUCT_PACKAGES += \
    VerticeLauncher

# AOSP Go defaults provide the broader low-RAM tuning. This does not claim
# Google Android Go certification.
$(call inherit-product, $(SRC_TARGET_DIR)/product/go_defaults_common.mk)

# Keep the VÉRTICE GSI's low-RAM property in the generic system image.
# Do not place this only in PRODUCT_VENDOR_PROPERTIES because a GSI build
# does not ship the OEM vendor image.
PRODUCT_SYSTEM_PROPERTIES += \
    ro.config.low_ram=true

PRODUCT_SYSTEM_SERVER_COMPILER_FILTER := speed-profile
