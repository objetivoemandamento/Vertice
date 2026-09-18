# VÉRTICE product overlays. These inherit the AOSP GSI/legacy-GSI
# products instead of modifying AOSP's own target/product/*.mk files.
PRODUCT_MAKEFILES := \
    $(LOCAL_DIR)/vertice_a04.mk \
    $(LOCAL_DIR)/vertice_redmi9a.mk

COMMON_LUNCH_CHOICES := \
    vertice_a04-userdebug \
    vertice_redmi9a-userdebug
