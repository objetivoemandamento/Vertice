# VÉRTICE GSI — device matrix

## Galaxy A04 (SM-A045F)
- Build profile: Android 12 GSI / gsi_arm64-userdebug
- Userspace: ARM64
- Binder: 64-bit
- System-as-root: yes
- Status: build target
- Hardware compatibility: must be verified on the exact SKU/vendor image; the generic image alone does not prove device boot.

## Redmi 9A (dandelion)
- Build profile: Android 10 legacy GSI / aosp_arm_64b_ab-userdebug
- Userspace: ARM32
- Binder: 64-bit
- System-as-root: yes
- Status: experimental build target
- Hardware compatibility: requires Treble/VNDK/vendor validation on the exact firmware.

## Galaxy J2 Core (SM-J260F family)
- Status: NOT included in the modern build matrix.
- Reason: the project does not have sufficient verified evidence that a current GSI target is compatible with the device's exact legacy vendor/partition layout.
- This is a compatibility limitation, not a claim that every J2 Core variant can never boot any historical GSI.
- A separate legacy experiment may be created only after identifying the exact model, launch API, Treble status, Binder mode and partition layout.

## Evidence rule
system.img creation means only that the AOSP/GSI product built successfully. It does not prove that a phone boots it. Device validation requires exact hardware/vendor evidence and, ultimately, boot/runtime testing.
