# VERTICE GSI integration fragment.
PRODUCT_PACKAGES += \
    VerticeLauncher
PRODUCT_COPY_FILES += \
    device/vertice/gsi/privapp-permissions-vertice.xml:system/etc/permissions/privapp-permissions-vertice.xml
PRODUCT_PRODUCT_PROPERTIES += \
    ro.config.low_ram=true
