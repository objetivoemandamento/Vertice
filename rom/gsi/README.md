# VÉRTICE GSI — corrected architecture

This directory contains isolated VÉRTICE product overlays. The workflow never appends variables to upstream AOSP target/product files.

## Profiles

- Galaxy A04: Android 12 GSI, ARM64 userspace, Binder64, system-as-root.
- Redmi 9A: Android 10 legacy GSI, ARM32 userspace, Binder64, A/B + system-as-root.
- Galaxy J2 Core: compatibility gate only. No modern image is published until the exact variant and legacy vendor layout are verified.

## Android Go terminology

VÉRTICE uses AOSP Go defaults plus low-RAM configuration for a lightweight profile. This must not be described as Google Android Go certification.

## Launcher integration

The APK declares MAIN/LAUNCHER/HOME/DEFAULT on the exported launcher activity. Soong imports it as a privileged prebuilt and signs the imported APK with the AOSP platform certificate. Stock launcher modules are overridden in the product package list.

## Evidence levels

A successful AOSP build proves only that the source tree produced a system image. It does not prove that a specific OEM phone boots it. Hardware compatibility requires exact device/vendor evidence and runtime testing.

## Safety

Do not flash any image to a phone based only on the CI result. Verify bootloader state, Treble/VINTF, vendor compatibility, partition layout, AVB and the exact model first.
