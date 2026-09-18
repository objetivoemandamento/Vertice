# Shared VÉRTICE launcher/low-RAM integration.
#
# This is intentionally a product fragment. It is inherited by a VÉRTICE
# product overlay and never appended to an upstream AOSP target file.

PRODUCT_PACKAGES += \
    VerticeLauncher

# Android Go/low-RAM behavior is based on AOSP's Go defaults plus the
# explicit low-RAM property. This is not a claim of Google Android Go
# certification.
$(call inherit-product, $(SRC_TARGET_DIR)/product/go_defaults_common.mk)

PRODUCT_VENDOR_PROPERTIES += \
    ro.config.low_ram=true

PRODUCT_SYSTEM_SERVER_COMPILER_FILTER := speed-profile
