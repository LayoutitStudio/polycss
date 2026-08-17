#!/usr/bin/env python3
"""Dependency-free independent domformat@0 reader and inspector.

This implementation intentionally shares no code with src/.  It validates the
bounded JSON transport, retained construction plan, resource integrity,
CSS closure, and state/binding graph.  It does not execute PolyCSS codecs.
"""

from __future__ import annotations

import argparse
from array import array
import base64
import binascii
import hashlib
import gzip
import io
import json
import math
import os
import re
import stat as stat_module
import struct
import sys
import unicodedata
from pathlib import Path
from typing import Any


DOCUMENT_FIELDS = ("meta", "tree", "cssBinding", "state", "bindings", "resources")
BASE64_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
BASE64_ALPHABET = frozenset(BASE64_CHARACTERS)
STATE_INTERPRETERS = {
    "polycss-compositor-timing-prepared@0": "polycss-compositor-timing@0",
    "polycss-effects-prepared@0": "polycss-effects@0",
    "polycss-orbit-input-prepared@0": "polycss-orbit-input@0",
    "polycss-paged-playback@0": "polycss-paged-playback@0",
    "polycss-paged-variants@0": "polycss-paged-variants@0",
    "polycss-playback-packed@0": "polycss-playback@0",
    "polycss-pointer-grab-prepared@0": "polycss-pointer-grab@0",
    "polycss-surface-packed@0": "polycss-surface@0",
    "polycss-variants-packed@0": "polycss-variants@0",
    "polycss-viewport-profiles-packed@0": "polycss-viewport-profiles@0",
    "static-presentation@0": "static-presentation@0",
}
KNOWN_REQUIRED_CAPABILITIES = {
    "css-semantic-closure",
    "deterministic-json",
    "explicit-retained-tree",
    "logical-assets",
    "prepared-particle-effects",
    "prepared-compositor-timing",
    "prepared-orbit-input",
    "prepared-paged-state",
    "prepared-playback",
    "prepared-pointer-grab-interaction",
    "prepared-surface-lighting",
    "prepared-variants",
    "prepared-viewport-profiles",
}
ALLOWED_ELEMENTS = {"b", "div", "i", "img", "s", "span", "u"}
ALLOWED_ATTRIBUTES = {
    "alt", "aria-hidden", "class", "decoding", "draggable", "height",
    "role", "width",
}
ALLOWED_STYLES = {
    "backgroundColor", "backgroundPosition", "backgroundPositionY",
    "backgroundRepeat", "backgroundSize", "height", "left", "objectFit",
    "borderBottomLeftRadius", "borderBottomRightRadius", "borderShape",
    "borderTopLeftRadius", "borderTopRightRadius", "color",
    "cornerBottomLeftShape", "cornerBottomRightShape",
    "cornerTopLeftShape", "cornerTopRightShape",
    "objectPosition", "opacity", "perspective", "perspectiveOrigin",
    "position", "top", "transform", "transformOrigin", "transformStyle",
    "visibility", "width",
}
ALLOWED_MOUNT_STYLES = {
    "backgroundColor", "backgroundPosition", "backgroundRepeat",
    "backgroundSize", "position",
}
ALLOWED_SINKS = {
    "class.prepared", "style.backgroundColor", "style.backgroundPosition", "style.backgroundPositionX",
    "style.backgroundPositionY", "style.color", "style.display", "style.height",
    "style.left", "style.opacity", "style.outlineColor", "style.top", "style.transform",
    "style.visibility", "style.width",
}
VARIANT_EFFECT_PROPERTIES = {
    "backgroundColor": "style.backgroundColor",
    "backgroundPositionX": "style.backgroundPositionX",
    "color": "style.color",
    "display": "style.display",
    "outlineColor": "style.outlineColor",
}
MEDIA_TYPES = {
    "application/vnd.layoutit.domformat-state-page+json",
    "image/png", "image/webp", "text/css;charset=utf-8",
}
BASE_REQUIRED_CAPABILITIES = [
    "css-semantic-closure", "deterministic-json", "explicit-retained-tree", "logical-assets",
]
CAPABILITY_INTERPRETER_ORDER = [
    ("polycss-effects@0", "prepared-particle-effects"),
    ("polycss-compositor-timing@0", "prepared-compositor-timing"),
    ("polycss-orbit-input@0", "prepared-orbit-input"),
    ("polycss-paged-playback@0", "prepared-playback"),
    ("polycss-paged-variants@0", "prepared-variants"),
    ("polycss-pointer-grab@0", "prepared-pointer-grab-interaction"),
    ("polycss-playback@0", "prepared-playback"),
    ("polycss-surface@0", "prepared-surface-lighting"),
    ("polycss-variants@0", "prepared-variants"),
    ("polycss-viewport-profiles@0", "prepared-viewport-profiles"),
]
CONFORMANCE_INTERPRETER_ORDER = [
    ("polycss-effects@0", "particle-effects"),
    ("polycss-compositor-timing@0", "compositor-timing"),
    ("polycss-orbit-input@0", "orbit-input"),
    ("polycss-paged-variants@0", "paged-variants"),
    ("polycss-paged-playback@0", "paged-playback"),
    ("polycss-playback@0", "playback"),
    ("polycss-pointer-grab@0", "pointer-grab-interaction"),
    ("static-presentation@0", "presentation"),
    ("polycss-surface@0", "surface-lighting"),
    ("polycss-variants@0", "variants"),
    ("polycss-viewport-profiles@0", "viewport-profiles"),
]
INLINE_SAFE_FUNCTIONS = frozenset("""
abs acos asin atan atan2 calc clamp color color-mix cos exp hsl hsla hwb hypot
lab lch linear-gradient log matrix matrix3d max min mod oklab oklch polygon pow
radial-gradient rem rgb rgba rotate rotate3d rotatex rotatey rotatez round scale
scale3d scalex scaley scalez sign sin skew skewx skewy sqrt tan translate
translate3d translatex translatey translatez
""".split())
DEFAULT_LIMITS = {
    "file": 128 * 1024 * 1024,
    "decoded_total": 128 * 1024 * 1024,
    "nodes": 250_000,
    "depth": 64,
    "resources": 2048,
    "state_pages": 512,
    "resource": 64 * 1024 * 1024,
    "resource_total": 128 * 1024 * 1024,
    "state_page_bytes_total": 128 * 1024 * 1024,
    "css": 16 * 1024 * 1024,
    "css_rules": 8192,
    "css_selectors": 32_768,
    "css_selector_bytes": 4096,
    "css_declarations": 131_072,
    "css_functions": 131_072,
    "css_asset_tokens": 2048,
    "binding_inputs": 256,
    "frames": 10_000,
    "paged_frames": 64_000,
    "state_page_frames": 10_000,
    "timeline_ticks": 1_000_000,
    "prepared_transforms": 2_000_000,
    "prepared_states": 2_000_000,
    "prepared_changes": 4_000_000,
    # Surface validation revisits this matrix, so this bounds CPU as well as allocation.
    "visibility_cells": 8 * 1024 * 1024,
    "effect_particles": 10_000,
    "effect_spawn_tuples": 1_000_000,
    "interaction_controls": 256,
    "interaction_objects": 65_536,
    "interaction_vertices": 2_000_000,
    "interaction_weights": 4_000_000,
    "interaction_weight_references": 8_000_000,
    "interaction_leaf_rows": 4_000_000,
    "image_pixels_total": 128 * 1024 * 1024,
}
JSON_MAX_ARRAY_ITEMS = min(
    DEFAULT_LIMITS["decoded_total"] // 2 + 1,
    max(
        DEFAULT_LIMITS["nodes"] * 16,
        max(DEFAULT_LIMITS["resources"], DEFAULT_LIMITS["state_pages"]) * 2,
        DEFAULT_LIMITS["frames"] * 3,
        DEFAULT_LIMITS["timeline_ticks"],
        DEFAULT_LIMITS["prepared_transforms"],
        DEFAULT_LIMITS["prepared_states"],
        DEFAULT_LIMITS["prepared_changes"],
        DEFAULT_LIMITS["effect_particles"],
        DEFAULT_LIMITS["effect_spawn_tuples"],
        DEFAULT_LIMITS["interaction_controls"],
        DEFAULT_LIMITS["interaction_objects"] * 16,
        DEFAULT_LIMITS["interaction_vertices"] * 4,
        DEFAULT_LIMITS["interaction_weights"] * 3,
        DEFAULT_LIMITS["interaction_leaf_rows"] * 4,
    ),
)
JSON_MAX_OBJECT_MEMBERS = min(
    DEFAULT_LIMITS["decoded_total"] // 4 + 1,
    max(128, DEFAULT_LIMITS["resources"], DEFAULT_LIMITS["state_pages"]),
)
JSON_MAX_KEY_CODE_UNITS = 256
JSON_STRUCTURE = re.compile(r'["\[\]{}]')
JSON_CONTENT = re.compile(r'[^ \t\n\r,:]')


class DomError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        raise DomError(code, message)


def preflight_json_structure(text: str, label: str,
                             maximum_array_items: int = JSON_MAX_ARRAY_ITEMS,
                             maximum_object_members: int = JSON_MAX_OBJECT_MEMBERS,
                             maximum_key_code_units: int = JSON_MAX_KEY_CODE_UNITS) -> None:
    # JSON syntax and scalar validation remain the standard decoder's job. This
    # pass only proves structural allocation bounds before that decoder creates
    # Python lists/dicts. Scanning comma runs between strings/containers with C
    # string operations keeps large numeric tables linear without a Python call
    # per number.
    offset = 0
    stack: list[list[Any]] = []

    def malformed(message: str) -> None:
        raise DomError("MALFORMED_JSON", f"{label} {message}")

    def bound(frame: list[Any]) -> None:
        maximum = maximum_array_items if frame[0] == "[" else maximum_object_members
        count = frame[1] + (1 if frame[2] else 0)
        require(count <= maximum,
                "JSON_ARRAY_LIMIT" if frame[0] == "[" else "JSON_OBJECT_LIMIT",
                f"{label} {'array has too many items' if frame[0] == '[' else 'object has too many members'}")

    def mark_parent_content() -> None:
        if stack:
            stack[-1][2] = True
            bound(stack[-1])

    while offset < len(text):
        match = JSON_STRUCTURE.search(text, offset)
        end = match.start() if match else len(text)
        if stack and end > offset:
            commas = text.count(",", offset, end)
            stack[-1][1] += commas
            if stack[-1][0] == "{" and commas > 0:
                stack[-1][3] = True
            if JSON_CONTENT.search(text, offset, end):
                stack[-1][2] = True
            bound(stack[-1])
        if match is None:
            offset = len(text)
            break

        token = match.group(0)
        position = match.start()
        if token == '"':
            is_key = bool(stack and stack[-1][0] == "{" and stack[-1][3])
            mark_parent_content()
            cursor = position + 1
            while True:
                close = text.find('"', cursor)
                if close < 0:
                    malformed("contains an unterminated string")
                slash = close - 1
                slash_count = 0
                while slash > position and text[slash] == "\\":
                    slash_count += 1
                    slash -= 1
                if slash_count % 2 == 0:
                    if is_key:
                        require(close - position - 1 <= maximum_key_code_units * 6,
                                "JSON_KEY_LIMIT", f"{label} object key is excessive")
                        stack[-1][3] = False
                    offset = close + 1
                    break
                cursor = close + 1
            continue

        if token in "[{":
            mark_parent_content()
            require(len(stack) < 256, "JSON_DEPTH", f"{label} nesting is too deep")
            stack.append([token, 0, False, token == "{"])
        else:
            require(bool(stack), "MALFORMED_JSON", f"{label} has an unmatched closing delimiter")
            expected = "]" if stack[-1][0] == "[" else "}"
            if token != expected:
                malformed("has mismatched container delimiters")
            bound(stack[-1])
            stack.pop()
        offset = position + 1

    if stack:
        malformed("contains an unterminated container")


def strict_keys(value: Any, allowed: set[str], code: str, label: str) -> dict:
    require(isinstance(value, dict), code, f"{label} must be an object")
    unknown = set(value) - allowed
    require(not unknown, code, f"{label} has unsupported fields: {sorted(unknown)}")
    return value


def as_int(value: Any, code: str, label: str, minimum: int = 0) -> int:
    require(
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and (not isinstance(value, float) or value.is_integer())
        and abs(value) <= 9_007_199_254_740_991 and value >= minimum,
        code, f"{label} must be a safe integer",
    )
    return int(value)


def is_safe_int(value: Any, minimum: int = -9_007_199_254_740_991,
                maximum: int = 9_007_199_254_740_991) -> bool:
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) and float(value).is_integer()
            and minimum <= value <= maximum)


def integer_array(value: Any, maximum_length: int, code: str, label: str,
                  minimum: int = -9_007_199_254_740_991,
                  maximum: int = 9_007_199_254_740_991,
                  unique: bool = False) -> list[int]:
    require(isinstance(value, list) and len(value) <= maximum_length,
            code, f"{label} is missing or excessive")
    require(all(is_safe_int(entry, minimum, maximum) for entry in value),
            code, f"{label} contains an invalid integer")
    result = [int(entry) for entry in value]
    if unique:
        require(len(set(result)) == len(result), code,
                f"{label} must not contain duplicates")
    return result


def cumulative_references(value: Any, count: int, code: str, label: str) -> list[int]:
    deltas = integer_array(value, count, code, label)
    require(len(deltas) == count, code, f"{label} does not match its declared count")
    current, result = 0, []
    for index, delta in enumerate(deltas):
        current += delta
        require(is_safe_int(current, 0), code,
                f"{label} reference {index} is invalid")
        result.append(current)
    return result


def validate_tick_cadence(parameters: dict, code: str, label: str) -> None:
    has_rate = "tickRateHz" in parameters
    has_interval = "tickIntervalUs" in parameters
    require(has_rate != has_interval, code, f"{label} must declare exactly one cadence")
    if has_rate:
        rate = parameters.get("tickRateHz")
        require(not isinstance(rate, bool) and isinstance(rate, (int, float))
                and math.isfinite(rate) and 1 <= rate <= 240,
                code, f"{label} tickRateHz is invalid")
        return
    interval = parameters.get("tickIntervalUs")
    require(isinstance(interval, list) and len(interval) == 2
            and all(is_safe_int(value, 1) for value in interval),
            code, f"{label} tickIntervalUs is invalid")
    numerator, denominator = int(interval[0]), int(interval[1])
    require(1_000_000 / 240 <= numerator / denominator <= 1_000_000
            and math.gcd(numerator, denominator) == 1,
            code, f"{label} tickIntervalUs is invalid or noncanonical")


def same_tick_cadence(left: dict, right: dict) -> bool:
    if "tickRateHz" in left or "tickRateHz" in right:
        return left.get("tickRateHz") == right.get("tickRateHz")
    return left.get("tickIntervalUs") == right.get("tickIntervalUs")


def finite_f32(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return False
    try:
        return math.isfinite(struct.unpack("<f", struct.pack("<f", float(value)))[0])
    except (OverflowError, struct.error):
        return False


def f32(value: float) -> float:
    try:
        return struct.unpack("<f", struct.pack("<f", float(value)))[0]
    except (OverflowError, struct.error) as error:
        raise DomError("INVALID_F32", "Float32 operation overflowed") from error


def interaction_f32(value: float) -> float:
    try:
        result = f32(value)
        return result if math.isfinite(result) else math.nan
    except DomError:
        return math.nan


def interaction_add_f32(left: float, right: float) -> float:
    return interaction_f32(interaction_f32(left) + interaction_f32(right))


def interaction_mul_f32(left: float, right: float) -> float:
    return interaction_f32(interaction_f32(left) * interaction_f32(right))


def interaction_transform_f32(value: list[float], matrix: list[float]) -> list[float]:
    output = []
    for column in range(3):
        result = interaction_mul_f32(matrix[column], value[0])
        result = interaction_add_f32(result,
                                     interaction_mul_f32(matrix[4 + column], value[1]))
        result = interaction_add_f32(result,
                                     interaction_mul_f32(matrix[8 + column], value[2]))
        output.append(result)
    return output


def interaction_grab_displacement_bounds(input_contract: dict,
                                         source: dict) -> list[float] | None:
    cursor_bounds = input_contract["cursorBounds"]
    span_x = interaction_f32(cursor_bounds[1] - cursor_bounds[0])
    span_y = interaction_f32(cursor_bounds[3] - cursor_bounds[2])
    if not math.isfinite(span_x) or not math.isfinite(span_y):
        return None
    bounds = [0.0, 0.0, 0.0]
    for delta_x in (-span_x, span_x):
        for delta_y in (-span_y, span_y):
            transformed = interaction_transform_f32([
                interaction_mul_f32(delta_x, source["displacementMagnitude"]),
                interaction_mul_f32(delta_y, source["displacementMagnitude"]),
                0.0,
            ], source["inverseCameraMatrix"])
            if not all(math.isfinite(component) for component in transformed):
                return None
            bounds = [max(bound, abs(component))
                      for bound, component in zip(bounds, transformed)]
    return bounds


def interaction_projected_f32(position: list[float], source: dict) -> list[float] | None:
    camera = interaction_transform_f32(position, source["cameraViewMatrix"])
    camera = [interaction_add_f32(component, source["cameraViewMatrix"][12 + index])
              for index, component in enumerate(camera)]
    if not all(math.isfinite(component) for component in camera) or abs(camera[2]) <= 1e-6:
        return None
    projection = source["projection"]
    x_scale = interaction_f32(projection["scale"] / interaction_f32(-camera[2]))
    y_scale = interaction_f32(projection["scale"] / camera[2])
    projected = [
        interaction_add_f32(interaction_mul_f32(camera[0], x_scale), projection["origin"][0]),
        interaction_add_f32(interaction_mul_f32(camera[1], y_scale), projection["origin"][1]),
    ]
    return projected if all(math.isfinite(component) for component in projected) else None


def interaction_magnitude_f32(value: list[float]) -> bool:
    squared = interaction_mul_f32(value[0], value[0])
    squared = interaction_add_f32(squared, interaction_mul_f32(value[1], value[1]))
    squared = interaction_add_f32(squared, interaction_mul_f32(value[2], value[2]))
    return (math.isfinite(squared) and squared >= 0
            and math.isfinite(interaction_f32(math.sqrt(squared))))


def interaction_reconstruction_is_finite(closure: dict, row: int, component: int,
                                         offset_bound: float) -> bool:
    weight_offset = int(closure["vertexRows"][row * 4 + 2])
    weight_count = int(closure["vertexRows"][row * 4 + 3])
    for offset in (-offset_bound, 0.0, offset_bound):
        value = interaction_f32(closure["vertexPositions"][row * 3 + component])
        for index in range(weight_offset, weight_offset + weight_count):
            translation = interaction_add_f32(
                closure["weightBaseTranslations"][index * 3 + component],
                offset if closure["weightActiveFlags"][index] == 1 else 0.0)
            contribution = interaction_add_f32(
                closure["weightLinearContributions"][index * 3 + component],
                translation)
            value = interaction_add_f32(
                value, interaction_mul_f32(contribution, closure["weightScalars"][index]))
            if not math.isfinite(value):
                return False
    return True


def finite_f32_array(value: Any, length: int, code: str, label: str) -> list[float]:
    require(isinstance(value, list) and len(value) == length
            and all(finite_f32(entry) for entry in value),
            code, f"{label} must contain {length} finite f32 values")
    return [float(entry) for entry in value]


def base64_integers(value: Any, width: int, maximum_count: int,
                    code: str, label: str) -> list[int]:
    decoded_length = canonical_base64_decoded_length(value, label, code)
    require(decoded_length % width == 0 and decoded_length // width <= maximum_count,
            code, f"{label} is truncated or excessive")
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise DomError(code, f"{label} is not valid base64") from error
    require(len(payload) == decoded_length
            and base64.b64encode(payload).decode("ascii") == value,
            code, f"{label} is not canonical base64")
    return [int.from_bytes(payload[offset:offset + width], "little")
            for offset in range(0, len(payload), width)]


def base64_float64(value: Any, maximum_count: int,
                   code: str, label: str) -> list[float]:
    decoded_length = canonical_base64_decoded_length(value, label, code)
    require(decoded_length % 8 == 0 and decoded_length // 8 <= maximum_count,
            code, f"{label} is truncated or excessive")
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise DomError(code, f"{label} is not valid base64") from error
    require(len(payload) == decoded_length
            and base64.b64encode(payload).decode("ascii") == value,
            code, f"{label} is not canonical base64")
    return [struct.unpack_from("<d", payload, offset)[0]
            for offset in range(0, len(payload), 8)]


def exact_array(value: Any, expected: list[Any], code: str, message: str) -> None:
    require(isinstance(value, list) and value == expected, code, message)


def unique_targets(value: Any, maximum: int, code: str, label: str) -> list[str]:
    require(isinstance(value, list) and len(value) <= maximum,
            code, f"{label} targets are invalid or excessive")
    targets = [stable_id(target, f"{label} target") for target in value]
    require(len(set(targets)) == len(targets), code,
            f"{label} targets contain duplicates")
    return targets


def multiply_f32_matrices(left: list[float], right: list[float]) -> list[float]:
    output = []
    for row in range(4):
        for column in range(4):
            value = f32(f32(left[row * 4]) * f32(right[column]))
            for index in range(1, 4):
                value = f32(value + f32(f32(left[row * 4 + index])
                                        * f32(right[index * 4 + column])))
            output.append(value)
    return output


def interaction_eye_matrix_is_finite(rotation: list[float], inverse: list[float],
                                     offset_bound: float) -> bool:
    offsets = (0.0,) if offset_bound == 0 else (-offset_bound, offset_bound)
    try:
        for x_value in offsets:
            for y_value in offsets:
                for z_value in offsets:
                    translated = list(rotation)
                    translated[12] = interaction_add_f32(translated[12], x_value)
                    translated[13] = interaction_add_f32(translated[13], y_value)
                    translated[14] = interaction_add_f32(translated[14], z_value)
                    if (not all(math.isfinite(value) for value in translated)
                            or not all(math.isfinite(value) for value in
                                       multiply_f32_matrices(translated, inverse))):
                        return False
    except DomError:
        return False
    return True


def inverse_matrix_pair(left: list[float], right: list[float]) -> bool:
    try:
        products = (multiply_f32_matrices(left, right),
                    multiply_f32_matrices(right, left))
    except DomError:
        return False
    return all(all(math.isfinite(value)
                   and abs(value - (1 if index % 5 == 0 else 0)) <= 1e-4
                   for index, value in enumerate(product))
               for product in products)


def safe_style(value: Any, label: str) -> str:
    require(isinstance(value, str) and len(value) <= 4096,
            "INVALID_STYLE_VALUE", f"{label} must be a short string")
    lower = value.lower()
    require(not any(token in value for token in ("\\", "/*", "*/"))
            and not any(token in lower for token in
                        ("url(", "javascript:", "expression(", "@import", "!important"))
            and not any(token in value for token in (";", "{", "}", "--"))
            and all(ord(character) >= 0x20 or character in "\t\n\f\r" for character in value),
            "UNSAFE_STYLE_VALUE", f"{label} is unsafe")
    quote, depth, index = "", 0, 0
    while index < len(value):
        character = value[index]
        if quote:
            if character == quote:
                quote = ""
            index += 1
            continue
        if character in "\"'":
            quote = character
            index += 1
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            require(depth >= 0, "UNSAFE_STYLE_VALUE",
                    f"{label} has unbalanced function delimiters")
        if re.match(r"[A-Za-z_-]", character):
            cursor = index + 1
            while cursor < len(value) and re.match(r"[A-Za-z0-9_-]", value[cursor]):
                cursor += 1
            open_paren = cursor
            while open_paren < len(value) and value[open_paren] in "\t\n\f\r ":
                open_paren += 1
            if open_paren < len(value) and value[open_paren] == "(":
                require(open_paren == cursor, "UNSAFE_STYLE_VALUE",
                        f"{label} separates a function name from its opening parenthesis")
                name = value[index:cursor].lower()
                require(name in INLINE_SAFE_FUNCTIONS, "UNSAFE_STYLE_VALUE",
                        f"{label} uses context-dependent or unsupported function {name}()")
            index = cursor
            continue
        index += 1
    require(not quote and depth == 0, "UNSAFE_STYLE_VALUE",
            f"{label} has unterminated strings or functions")
    return value


def utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be")


def ecma_number(value: float) -> str:
    require(math.isfinite(value), "INVALID_NUMBER", "JSON number is not finite")
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    source = repr(abs(value)).lower()
    if "e" in source:
        mantissa, exponent_text = source.split("e", 1)
        exponent = int(exponent_text)
    else:
        mantissa, exponent = source, 0
    if "." in mantissa:
        whole, fraction = mantissa.split(".", 1)
        digits = whole + fraction
        decimal_position = len(whole) + exponent
        while digits.endswith("0"):
            digits = digits[:-1]
    else:
        digits = mantissa
        decimal_position = len(mantissa) + exponent
    require(bool(digits), "INVALID_NUMBER", "JSON number has no digits")
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        if decimal_position <= 0:
            body = "0." + "0" * (-decimal_position) + digits
        elif decimal_position >= len(digits):
            body = digits + "0" * (decimal_position - len(digits))
        else:
            body = digits[:decimal_position] + "." + digits[decimal_position:]
        return sign + body
    scientific_exponent = decimal_position - 1
    body = digits[0] + (("." + digits[1:]) if len(digits) > 1 else "")
    exponent_sign = "+" if scientific_exponent >= 0 else "-"
    return f"{sign}{body}e{exponent_sign}{abs(scientific_exponent)}"


def canonical_encode(value: Any, depth: int = 0) -> bytes:
    require(depth <= 256, "JSON_DEPTH", "Canonical JSON nesting is too deep")
    if value is None:
        return b"null"
    if value is True:
        return b"true"
    if value is False:
        return b"false"
    if isinstance(value, int):
        require(abs(value) <= 9_007_199_254_740_991, "INVALID_NUMBER",
                "Generated canonical integer is not safe")
        return str(value).encode("ascii")
    if isinstance(value, float):
        return ecma_number(value).encode("ascii")
    if isinstance(value, str):
        require(all(not 0xD800 <= ord(ch) <= 0xDFFF for ch in value),
                "INVALID_UNICODE", "JSON string contains a surrogate")
        normalized = unicodedata.normalize("NFC", value)
        return json.dumps(normalized, ensure_ascii=False,
                          separators=(",", ":")).encode("utf-8")
    if isinstance(value, list):
        return b"[" + b",".join(canonical_encode(item, depth + 1)
                                  for item in value) + b"]"
    require(isinstance(value, dict), "INVALID_JSON_VALUE",
            "Value is not canonical JSON data")
    entries = []
    for key in sorted(value, key=utf16_sort_key):
        require(sum(2 if ord(ch) > 0xffff else 1 for ch in key) <= JSON_MAX_KEY_CODE_UNITS,
                "JSON_KEY_LIMIT", "JSON object key is excessive")
        entries.append(canonical_encode(key, depth + 1) + b":"
                       + canonical_encode(value[key], depth + 1))
    return b"{" + b",".join(entries) + b"}"


def parse_canonical_json(payload: bytes, label: str) -> Any:
    try:
        text = payload.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise DomError("MALFORMED_UTF8", f"{label} is not UTF-8: {error}") from error
    require(not text.startswith("\ufeff"), "MALFORMED_UTF8",
            f"{label} begins with a byte-order mark")
    preflight_json_structure(text, label)

    def pairs_hook(pairs: list[tuple[str, Any]]) -> dict:
        result = {}
        for raw_key, item in pairs:
            require(sum(2 if ord(ch) > 0xffff else 1 for ch in raw_key) <= JSON_MAX_KEY_CODE_UNITS, "JSON_KEY_LIMIT",
                    f"{label} object key is excessive")
            require(all(not 0xD800 <= ord(ch) <= 0xDFFF for ch in raw_key),
                    "INVALID_UNICODE", f"{label} key contains a surrogate")
            key = unicodedata.normalize("NFC", raw_key)
            require(key not in result, "DUPLICATE_NORMALIZED_KEY",
                    f"{label} has duplicate normalized key {key!r}")
            result[key] = item
        return result

    def bad_constant(value: str) -> None:
        raise DomError("INVALID_NUMBER", f"{label} contains {value}")

    try:
        value = json.loads(text, object_pairs_hook=pairs_hook,
                           parse_int=float, parse_float=float,
                           parse_constant=bad_constant)
    except DomError:
        raise
    except (ValueError, RecursionError) as error:
        raise DomError("MALFORMED_JSON", f"{label} is not JSON: {error}") from error
    encoded = canonical_encode(value)
    require(encoded == payload, "NON_CANONICAL_JSON",
            f"{label} is not canonically encoded")
    return value


def parse_json(payload: bytes, label: str) -> Any:
    try:
        text = payload.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise DomError("MALFORMED_UTF8", f"{label} is not UTF-8: {error}") from error
    require(not text.startswith("\ufeff"), "MALFORMED_UTF8",
            f"{label} begins with a byte-order mark")
    preflight_json_structure(text, label)

    def pairs_hook(pairs: list[tuple[str, Any]]) -> dict:
        result = {}
        for key, item in pairs:
            require(sum(2 if ord(ch) > 0xffff else 1 for ch in key) <= JSON_MAX_KEY_CODE_UNITS, "JSON_KEY_LIMIT",
                    f"{label} object key is excessive")
            require(all(not 0xD800 <= ord(ch) <= 0xDFFF for ch in key),
                    "INVALID_UNICODE", f"{label} key contains a surrogate")
            require(key == unicodedata.normalize("NFC", key),
                    "NON_NORMALIZED_JSON", f"{label} keys must use NFC")
            require(key not in result, "DUPLICATE_NORMALIZED_KEY",
                    f"{label} has duplicate key {key!r}")
            result[key] = item
        return result

    def integer(token: str) -> float:
        require(token != "-0", "INVALID_NUMBER", f"{label} must not encode negative zero")
        value = float(token)
        require(math.isfinite(value), "INVALID_NUMBER",
                f"{label} contains a non-finite number")
        return value

    def floating(token: str) -> float:
        value = float(token)
        require(math.isfinite(value) and not (value == 0 and token.startswith("-")),
                "INVALID_NUMBER", f"{label} contains an invalid number")
        return value

    def bad_constant(value: str) -> None:
        raise DomError("INVALID_NUMBER", f"{label} contains {value}")

    try:
        value = json.loads(text, object_pairs_hook=pairs_hook,
                           parse_int=integer, parse_float=floating,
                           parse_constant=bad_constant)
    except DomError:
        raise
    except (ValueError, RecursionError) as error:
        raise DomError("MALFORMED_JSON", f"{label} is not JSON: {error}") from error

    def validate(item: Any, depth: int = 0) -> None:
        require(depth <= 256, "JSON_DEPTH", f"{label} nesting is too deep")
        if isinstance(item, str):
            require(all(not 0xD800 <= ord(ch) <= 0xDFFF for ch in item),
                    "INVALID_UNICODE", f"{label} string contains a surrogate")
            require(item == unicodedata.normalize("NFC", item),
                    "NON_NORMALIZED_JSON", f"{label} strings must use NFC")
        elif isinstance(item, list):
            for entry in item:
                validate(entry, depth + 1)
        elif isinstance(item, dict):
            for entry in item.values():
                validate(entry, depth + 1)
        elif isinstance(item, float):
            require(math.isfinite(item), "INVALID_NUMBER", f"{label} number is not finite")

    validate(value)
    return value


def parse_transport(data: bytes, limits: dict[str, int]) -> tuple[str, bytes]:
    require(len(data) <= limits["file"], "FILE_LIMIT", "File is too large")
    require(not data.startswith(b"\x1f\x8b"), "UNSUPPORTED_TRANSPORT",
            "domformat@0 accepts plain JSON only")
    require(len(data) <= limits["decoded_total"], "DOCUMENT_DECODED_LIMIT",
            "JSON is too large")
    return "json", bytes(data)


def canonical_base64_decoded_length(value: Any, label: str,
                                    code: str = "INVALID_RESOURCE_BASE64") -> int:
    require(isinstance(value, str) and len(value) % 4 == 0,
            code, f"{label} is not canonical base64")
    padding = 2 if value.endswith("==") else 1 if value.endswith("=") else 0
    body_length = len(value) - padding
    require(all(value[index] in BASE64_ALPHABET for index in range(body_length))
            and all(value[index] == "=" for index in range(body_length, len(value)))
            and (padding == 0 or (len(value) >= 4
                 and body_length % 4 == (2 if padding == 2 else 3))),
            code, f"{label} is not canonical base64")
    if padding == 2:
        require(BASE64_CHARACTERS.index(value[body_length - 1]) & 15 == 0,
                code, f"{label} has nonzero padding bits")
    elif padding == 1:
        require(BASE64_CHARACTERS.index(value[body_length - 1]) & 3 == 0,
                code, f"{label} has nonzero padding bits")
    return len(value) // 4 * 3 - padding


def stable_id(value: Any, label: str) -> str:
    require(isinstance(value, str) and re.fullmatch(r"[a-z][A-Za-z0-9._:/-]{0,127}", value)
            and ".." not in value and "//" not in value,
            "INVALID_STABLE_ID", f"{label} is invalid")
    return value


def resource_id(value: Any, label: str) -> str:
    require(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9._-]{0,63}", value),
            "INVALID_RESOURCE_ID", f"{label} is invalid")
    return value


def safe_path(value: Any, label: str) -> str:
    require(isinstance(value, str) and 0 < len(value) <= 240 and not value.startswith(("/", "\\"))
            and "\\" not in value and not any(ch in value for ch in ":%?#"),
            "UNSAFE_RESOURCE_PATH", f"{label} is unsafe")
    parts = value.split("/")
    reserved = re.compile(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])", re.IGNORECASE)
    require(all(part not in ("", ".", "..") and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", part)
                and not part.endswith(".") and not reserved.fullmatch(part.split(".", 1)[0])
                for part in parts), "UNSAFE_RESOURCE_PATH", f"{label} is unsafe or nonportable")
    return value


def real_directory(path: Path, code: str, label: str) -> Path:
    metadata = path.lstat()
    require(stat_module.S_ISDIR(metadata.st_mode) and not stat_module.S_ISLNK(metadata.st_mode),
            code, f"{label} must be a real directory, not a symbolic link")
    return path.resolve(strict=True)


def reject_symlink_components(base: Path, relative: str, code: str, label: str) -> None:
    current = base
    parts = relative.split("/")
    for index, part in enumerate(parts):
        current = current / part
        metadata = current.lstat()
        require(not stat_module.S_ISLNK(metadata.st_mode), code,
                f"{label} contains a symbolic-link path component")
        if index < len(parts) - 1:
            require(stat_module.S_ISDIR(metadata.st_mode), code,
                    f"{label} contains a non-directory path component")


def validate_meta(meta: Any) -> None:
    meta = strict_keys(meta, {"format", "profile", "title", "generator",
                              "capabilities", "optionalCapabilities", "initialExperience",
                              "conformance", "counts", "artifacts", "claims"},
                       "INVALID_META", "META")
    require(meta.get("format") == "domformat@0", "UNSUPPORTED_FORMAT", "Unsupported format")
    require(meta.get("profile") == "polycss-3d@0", "UNSUPPORTED_PROFILE", "Unsupported profile")
    require(isinstance(meta.get("title"), str) and 0 < len(meta["title"]) <= 256,
            "INVALID_TITLE", "Invalid title")
    generator = strict_keys(meta.get("generator"), {"name", "version"}, "INVALID_META", "generator")
    require(isinstance(generator.get("name"), str)
            and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", generator["name"])
            and isinstance(generator.get("version"), str)
            and re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,63}", generator["version"]),
            "INVALID_META", "Invalid generator")
    capabilities = meta.get("capabilities")
    require(isinstance(capabilities, list) and 0 < len(capabilities) <= 128
            and all(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", value)
                    for value in capabilities)
            and len(set(capabilities)) == len(capabilities), "INVALID_META", "Invalid required capabilities")
    unknown = [value for value in capabilities if value not in KNOWN_REQUIRED_CAPABILITIES]
    require(not unknown, "UNSUPPORTED_REQUIRED_CAPABILITY", f"Unsupported required capability {unknown[0] if unknown else ''}")
    optional_capabilities = meta.get("optionalCapabilities")
    if optional_capabilities is not None:
        require(isinstance(optional_capabilities, list) and len(optional_capabilities) <= 128
                and all(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", value)
                        for value in optional_capabilities)
                and len(set(optional_capabilities)) == len(optional_capabilities)
                and not set(optional_capabilities).intersection(capabilities)
                and all(optional_capabilities[index - 1] < value
                        for index, value in enumerate(optional_capabilities) if index > 0),
                "INVALID_META", "Invalid optional capabilities")
    require("initialExperience" not in meta or meta["initialExperience"] in ("animation", "interaction"),
            "INVALID_META", "Invalid initial experience")
    conformance = strict_keys(meta.get("conformance"), {"executable", "declaredOnly"}, "INVALID_META", "conformance")
    combined = []
    for key in ("executable", "declaredOnly"):
        values = conformance.get(key)
        require(isinstance(values, list) and len(values) <= 128
                and all(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", value)
                        for value in values)
                and len(set(values)) == len(values), "INVALID_META", f"Invalid conformance.{key}")
        combined.extend(values)
    require(len(set(combined)) == len(combined), "INVALID_META", "Conformance sets overlap")
    counts = meta.get("counts")
    if counts is not None:
        counts = strict_keys(counts, {"nodes", "shapes", "leaves", "sourceFrames"}, "INVALID_META", "counts")
        for key, value in counts.items():
            as_int(value, "INVALID_META", f"counts.{key}")
    artifact_ids: set[str] = set()
    artifacts = meta.get("artifacts")
    if artifacts is not None:
        require(isinstance(artifacts, list) and 0 < len(artifacts) <= 64,
                "INVALID_META", "Invalid artifacts")
        previous = ""
        for index, artifact in enumerate(artifacts):
            artifact = strict_keys(artifact, {"id", "role", "byteLength", "decodedByteLength", "digest"},
                                   "INVALID_META", f"artifact {index}")
            aid = artifact.get("id")
            require(isinstance(aid, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", aid)
                    and aid > previous, "INVALID_META", "Artifacts are not canonically ordered")
            previous = aid
            artifact_ids.add(aid)
            require(isinstance(artifact.get("role"), str) and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", artifact["role"]),
                    "INVALID_META", "Invalid artifact role")
            as_int(artifact.get("byteLength"), "INVALID_META", "artifact.byteLength")
            as_int(artifact.get("decodedByteLength"), "INVALID_META", "artifact.decodedByteLength")
            digest = strict_keys(artifact.get("digest"), {"algorithm", "value"}, "INVALID_META", "artifact.digest")
            require(digest.get("algorithm") == "sha256" and isinstance(digest.get("value"), str)
                    and re.fullmatch(r"[0-9a-f]{64}", digest["value"]), "INVALID_META", "Invalid artifact digest")
    claims = meta.get("claims")
    if claims is not None:
        require(isinstance(claims, list) and 0 < len(claims) <= 128 and artifact_ids,
                "INVALID_META", "Invalid claims")
        kinds = {"license", "locator", "qualification", "redistribution", "revision"}
        previous = ""
        for index, claim in enumerate(claims):
            claim = strict_keys(claim, {"artifact", "kind", "value"}, "INVALID_META", f"claim {index}")
            key = f"{claim.get('artifact')}\0{claim.get('kind')}"
            require(claim.get("artifact") in artifact_ids and claim.get("kind") in kinds and key > previous,
                    "INVALID_META", "Claims are not canonically ordered")
            previous = key
            value = claim.get("value")
            require(isinstance(value, str) and 0 < len(value) <= 512
                    and not re.search(r"[\x00-\x1f\x7f]", value), "INVALID_META", "Invalid claim value")
            require(not re.match(r"^(?:/|\\|[A-Za-z]:[\\/]|file:)", value)
                    and not re.search(r"(?:/Users/|/home/|\\Users\\)", value),
                    "META_LOCAL_PATH", "Claim leaks a local path")
            if claim.get("kind") == "locator":
                from urllib.parse import urlsplit
                locator = urlsplit(value)
                require(locator.scheme == "https" and locator.netloc and locator.username is None
                        and locator.password is None and not locator.fragment,
                        "INVALID_META", "Unsafe artifact locator")


def validate_resources(catalog: Any, limits: dict[str, int]) -> tuple[list[dict], dict[str, dict]]:
    catalog = strict_keys(catalog, {"version", "resources"}, "INVALID_RESOURCES", "RCRD")
    require(as_int(catalog.get("version"), "UNSUPPORTED_RESOURCE_SCHEMA", "RCRD version") == 0,
            "UNSUPPORTED_RESOURCE_SCHEMA", "RCRD version must be zero")
    records = catalog.get("resources")
    require(isinstance(records, list) and len(records) <= limits["resources"] + limits["state_pages"],
            "RESOURCE_COUNT_LIMIT", "Resource count exceeds the combined eager and state-page ceilings")
    by_id, previous, eager_resources, state_pages = {}, "", 0, 0
    eager_bytes, state_page_bytes, total_image_pixels, total_decoded_state, external_paths = 0, 0, 0, 0, set()
    for index, record in enumerate(records):
        record = strict_keys(record, {"id", "kind", "mediaType", "byteLength", "dimensions", "digest", "path",
                                      "encoding", "decodedByteLength", "decodedDigest", "codec"},
                             "INVALID_RESOURCE", f"resource {index}")
        rid = resource_id(record.get("id"), f"resource {index} id")
        require(rid > previous and rid not in by_id, "RESOURCE_ORDER", "Resources are not strictly sorted")
        previous = rid
        kind, media = record.get("kind"), record.get("mediaType")
        require(kind in ("stylesheet", "image", "state-page") and media in MEDIA_TYPES,
                "UNSUPPORTED_MEDIA_TYPE", f"Resource {rid} kind/media is invalid")
        require((kind == "stylesheet" and media == "text/css;charset=utf-8")
                or (kind == "image" and media.startswith("image/"))
                or (kind == "state-page" and media == "application/vnd.layoutit.domformat-state-page+json"),
                "RESOURCE_KIND_MEDIA_MISMATCH", f"Resource {rid} kind/media mismatch")
        size = as_int(record.get("byteLength"), "INVALID_RESOURCE_SIZE", f"resource {rid} size")
        require(size <= limits["resource"], "INVALID_RESOURCE_SIZE", f"Resource {rid} is too large")
        if kind == "state-page":
            state_pages += 1
            state_page_bytes += size
            require(state_pages <= limits["state_pages"], "RESOURCE_COUNT_LIMIT",
                    "State-page resource count is excessive")
            require(state_page_bytes <= limits["state_page_bytes_total"],
                    "AGGREGATE_RESOURCE_LIMIT", "Encoded state pages are too large")
        else:
            eager_resources += 1
            eager_bytes += size
            require(eager_resources <= limits["resources"], "RESOURCE_COUNT_LIMIT",
                    "Eager resource count is excessive")
            require(eager_bytes <= limits["resource_total"], "AGGREGATE_RESOURCE_LIMIT",
                    "Eager resources are too large")
        if kind == "image":
            dimensions = strict_keys(record.get("dimensions"), {"width", "height"},
                                     "INVALID_RESOURCE_DIMENSIONS", f"resource {rid} dimensions")
            width = as_int(dimensions.get("width"), "INVALID_RESOURCE_DIMENSIONS", "image width", 1)
            height = as_int(dimensions.get("height"), "INVALID_RESOURCE_DIMENSIONS", "image height", 1)
            require(width <= 16384 and height <= 16384 and width * height <= 64 * 1024 * 1024,
                    "IMAGE_DIMENSION_LIMIT", f"Resource {rid} dimensions are excessive")
            total_image_pixels += width * height
            require(total_image_pixels <= limits["image_pixels_total"],
                    "AGGREGATE_IMAGE_PIXEL_LIMIT", "Aggregate decoded image pixels are excessive")
        else:
            require("dimensions" not in record, "UNEXPECTED_RESOURCE_DIMENSIONS", "Non-image has dimensions")
        digest = strict_keys(record.get("digest"), {"algorithm", "value"}, "INVALID_RESOURCE_DIGEST", f"resource {rid} digest")
        require(digest.get("algorithm") == "sha256" and isinstance(digest.get("value"), str)
                and re.fullmatch(r"[0-9a-f]{64}", digest["value"]),
                "INVALID_RESOURCE_DIGEST", f"Resource {rid} digest is invalid")
        if kind == "state-page":
            require(record.get("encoding") in ("identity", "gzip"), "INVALID_STATE_PAGE_RESOURCE",
                    f"State page {rid} encoding is invalid")
            decoded_size = as_int(record.get("decodedByteLength"), "INVALID_STATE_PAGE_RESOURCE",
                                  f"state page {rid} decoded size")
            require(decoded_size <= limits["resource"], "INVALID_STATE_PAGE_RESOURCE",
                    f"State page {rid} decoded size is excessive")
            total_decoded_state += decoded_size
            require(total_decoded_state <= limits["decoded_total"], "AGGREGATE_DECODED_LIMIT",
                    "Decoded state pages are excessive")
            decoded_digest = strict_keys(record.get("decodedDigest"), {"algorithm", "value"},
                                         "INVALID_STATE_PAGE_RESOURCE", f"state page {rid} decoded digest")
            require(decoded_digest.get("algorithm") == "sha256"
                    and isinstance(decoded_digest.get("value"), str)
                    and re.fullmatch(r"[0-9a-f]{64}", decoded_digest["value"]),
                    "INVALID_STATE_PAGE_RESOURCE", f"State page {rid} decoded digest is invalid")
            require(record.get("codec") in ("polycss-paged-variants-page@0",
                                             "polycss-paged-playback-page@0"),
                    "INVALID_STATE_PAGE_RESOURCE", f"State page {rid} codec is invalid")
            if record["encoding"] == "identity":
                require(size == decoded_size and digest["value"] == decoded_digest["value"],
                        "INVALID_STATE_PAGE_RESOURCE", f"Identity state page {rid} identities differ")
        else:
            require(all(name not in record for name in ("encoding", "decodedByteLength", "decodedDigest", "codec")),
                    "INVALID_RESOURCE", f"Non-state resource {rid} has state-page fields")
        path = safe_path(record.get("path"), f"resource {rid} path")
        portable_path = path.lower()
        require(portable_path not in external_paths, "DUPLICATE_RESOURCE_PATH",
                f"Resource path {path} has a case-insensitive alias")
        require(all(not portable_path.startswith(existing + "/") and not existing.startswith(portable_path + "/")
                    for existing in external_paths), "RESOURCE_PATH_COLLISION",
                f"Resource path {path} has a file/directory collision")
        external_paths.add(portable_path)
        by_id[rid] = record
    return records, by_id


def validate_tree(tree: Any, resources: dict[str, dict], limits: dict[str, int]) -> tuple[list[dict], set[str]]:
    tree = strict_keys(tree, {"version", "mount", "nodes"}, "INVALID_TREE", "TREE")
    require(as_int(tree.get("version"), "UNSUPPORTED_TREE_SCHEMA", "TREE version") == 0,
            "UNSUPPORTED_TREE_SCHEMA", "TREE version must be zero")
    mount = strict_keys(tree.get("mount"), {"behavior", "attributes", "styles", "resourceStyles"}, "INVALID_MOUNT", "TREE mount")
    require(mount.get("behavior") == "replace-children", "INVALID_MOUNT", "Unsupported mount behavior")
    attributes = mount.get("attributes")
    require(isinstance(attributes, list) and len(attributes) <= 32, "INVALID_MOUNT", "Mount attributes invalid")
    names = set()
    for entry in attributes:
        require(isinstance(entry, list) and len(entry) == 2 and all(isinstance(x, str) for x in entry),
                "INVALID_MOUNT", "Mount attribute row is invalid")
        name, value = entry
        require(name not in ("data-domformat-instance", "data-domformat-mount-surface", "data-domformat-node")
                and (name in ALLOWED_ATTRIBUTES or re.fullmatch(r"data-[a-z][a-z0-9._:-]{0,63}", name))
                and name not in names and len(value) <= 1024,
                "UNSAFE_ATTRIBUTE", f"Mount attribute {name} is invalid")
        names.add(name)
    nodes = tree.get("nodes")
    require(isinstance(nodes, list) and len(nodes) <= limits["nodes"], "NODE_COUNT_LIMIT", "Node count invalid")
    ids, depths, siblings, parent_indices = set(), [], {}, set()
    for index, node in enumerate(nodes):
        node = strict_keys(node, {"index", "id", "parent", "sibling", "namespace", "name", "classes",
                                  "attributes", "styles", "resourceAttributes", "resourceStyles"},
                           "INVALID_NODE", f"node {index}")
        require(as_int(node.get("index"), "NODE_INDEX", f"node {index} index") == index,
                "NODE_INDEX", f"Node {index} index is noncanonical")
        nid = stable_id(node.get("id"), f"node {index} id")
        require(nid not in ids, "DUPLICATE_NODE_ID", f"Node id {nid} is duplicated")
        ids.add(nid)
        parent = as_int(node.get("parent"), "INVALID_PARENT", f"node {nid} parent", -1)
        require(parent == -1 or parent < index, "INVALID_PARENT", f"Node {nid} parent is invalid")
        if parent >= 0:
            parent_indices.add(parent)
        sibling = as_int(node.get("sibling"), "INVALID_SIBLING", f"node {nid} sibling")
        expected = siblings.get(parent, 0)
        require(sibling == expected, "INVALID_SIBLING", f"Node {nid} sibling is invalid")
        siblings[parent] = expected + 1
        depth = 1 if parent == -1 else depths[parent] + 1
        require(depth <= limits["depth"], "TREE_DEPTH_LIMIT", f"Node {nid} is too deep")
        depths.append(depth)
        require(node.get("namespace") == "http://www.w3.org/1999/xhtml" and node.get("name") in ALLOWED_ELEMENTS,
                "FORBIDDEN_ELEMENT", f"Node {nid} element is invalid")
        classes = node.get("classes", [])
        require(isinstance(classes, list) and len(classes) <= 32
                and all(isinstance(token, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,63}", token) for token in classes)
                and len(set(classes)) == len(classes),
                "INVALID_CLASS", f"Node {nid} classes are invalid")
        attrs = node.get("attributes", {})
        require(isinstance(attrs, dict) and len(attrs) <= 32, "INVALID_ATTRIBUTES", f"Node {nid} attributes invalid")
        for name, value in attrs.items():
            require(not name.lower().startswith("on")
                    and name not in ("class", "srcdoc", "style", "data-domformat-instance", "data-domformat-mount-surface", "data-domformat-node")
                    and (name in ALLOWED_ATTRIBUTES or re.fullmatch(r"data-[a-z][a-z0-9._:-]{0,63}", name))
                    and isinstance(value, str) and len(value) <= 1024,
                    "UNSAFE_ATTRIBUTE", f"Node {nid} attribute {name} is invalid")
        styles = node.get("styles", {})
        require(isinstance(styles, dict) and len(styles) <= 64, "INVALID_STYLES", f"Node {nid} styles invalid")
        for name, value in styles.items():
            require(name in ALLOWED_STYLES, "UNSAFE_STYLE_PROPERTY", f"Node {nid} style {name} invalid")
            safe_style(value, f"Node {nid} style {name}")
        resource_attrs = node.get("resourceAttributes", {})
        require(isinstance(resource_attrs, dict), "INVALID_RESOURCE_ATTRIBUTES", "Resource attributes invalid")
        for name, rid in resource_attrs.items():
            require(name == "src" and rid in resources and resources[rid]["kind"] == "image",
                    "RESOURCE_ROLE_MISMATCH", f"Node {nid} resource attribute is invalid")
        validate_resource_styles(node.get("resourceStyles", {}), resources, f"node {nid}")
    for node in nodes:
        if node["index"] not in parent_indices:
            require(node.get("attributes", {}).get("aria-hidden") == "true", "ACCESSIBILITY_REQUIRED",
                    f"Terminal visual node {node['id']} must be aria-hidden")
    styles = mount.get("styles", {})
    require(isinstance(styles, dict), "INVALID_MOUNT", "Mount styles invalid")
    for name, value in styles.items():
        require(name in ALLOWED_MOUNT_STYLES, "UNSAFE_STYLE_PROPERTY", f"Mount style {name} invalid")
        safe_style(value, f"Mount style {name}")
        if name == "position":
            require(value == "relative", "INVALID_MOUNT", "Mount position must be relative")
    validate_resource_styles(mount.get("resourceStyles", {}), resources, "mount")
    return nodes, ids


def validate_resource_styles(styles: Any, resources: dict[str, dict], label: str) -> None:
    require(isinstance(styles, dict), "INVALID_RESOURCE_STYLES", f"{label} resource styles invalid")
    for name, binding in styles.items():
        require(name == "backgroundImage", "UNSAFE_STYLE_PROPERTY", f"{label} resource style invalid")
        binding = strict_keys(binding, {"resource", "syntax", "overlayOpacity"}, "INVALID_RESOURCE_STYLE", f"{label} resource style")
        rid = binding.get("resource")
        require(rid in resources and resources[rid]["kind"] == "image", "RESOURCE_ROLE_MISMATCH", f"{label} image resource invalid")
        syntax = binding.get("syntax")
        require(syntax in ("url", "overlay-url"), "INVALID_RESOURCE_STYLE", f"{label} syntax invalid")
        if syntax == "overlay-url":
            opacity = binding.get("overlayOpacity")
            require(not isinstance(opacity, bool) and isinstance(opacity, (int, float))
                    and math.isfinite(opacity) and 0 <= opacity <= 1,
                    "INVALID_RESOURCE_STYLE", f"{label} overlay opacity invalid")
        else:
            require("overlayOpacity" not in binding, "INVALID_RESOURCE_STYLE", f"{label} URL has overlay opacity")


def collect_targets(value: Any, output: list[str], maximum: int, label: str,
                    maximum_depth: int = 64) -> None:
    stack: list[tuple[Any, int]] = [(value, 0)]
    visited: set[int] = set()
    structural_maximum = maximum * 4 + maximum_depth
    containers = 0
    entries = 0
    while stack:
        current, depth = stack.pop()
        if isinstance(current, str):
            output.append(current)
            require(len(output) <= maximum, "TARGET_CARDINALITY_MISMATCH",
                    f"{label} exceeds its target limit")
            continue
        require(isinstance(current, (list, dict)), "INVALID_TARGETS",
                f"{label} contains a non-target value")
        require(depth < maximum_depth, "TARGET_DEPTH_LIMIT",
                f"{label} exceeds its nesting limit")
        identity = id(current)
        require(identity not in visited, "INVALID_TARGETS",
                f"{label} contains repeated or cyclic target groups")
        visited.add(identity)
        containers += 1
        require(containers <= structural_maximum, "TARGET_CARDINALITY_MISMATCH",
                f"{label} has too many target containers")
        current_entries = current if isinstance(current, list) else list(current.values())
        entries += len(current_entries)
        require(entries <= structural_maximum, "TARGET_CARDINALITY_MISMATCH",
                f"{label} has too many target entries")
        for item in reversed(current_entries):
            stack.append((item, depth + 1))


def same_playback_timeline(left: dict, right: dict, profile: bool = False) -> bool:
    return ((not profile or left.get("profileId") == right.get("profileId"))
            and left.get("introTicks") == right.get("introTicks")
            and left.get("loopTicks") == right.get("loopTicks")
            and left.get("frames") == right.get("frames")
            and left.get("deadlineMicros") == right.get("deadlineMicros")
            and ("deadlineMicros" in left) == ("deadlineMicros" in right))


def validate_playback_banks(packet: dict, initial_source: int, frame_count: int,
                            validate_timeline: Any, timeline: dict,
                            timeline_tick_count: int, limits: dict[str, int],
                            code: str, label: str) -> int:
    has_initial_bank = "initialBankId" in packet
    has_banks = "banks" in packet
    require(has_initial_bank == has_banks, code,
            f"{label} initialBankId and banks must be declared together")
    if not has_banks:
        return timeline_tick_count
    initial_bank_id = stable_id(packet.get("initialBankId"), f"{label} initial bank id")
    banks = packet.get("banks")
    require(isinstance(banks, list) and 0 < len(banks) <= 64, code,
            f"{label} banks are missing or excessive")
    bank_ids: set[str] = set()
    entry_frames: set[int] = set()
    previous_bank_id = ""
    initial_bank: dict | None = None
    for bank_index, value in enumerate(banks):
        bank = strict_keys(value, {"id", "entryFrame", "timeline", "profileTimelines"},
                           code, f"{label} bank {bank_index}")
        require({"id", "entryFrame", "timeline"} <= set(bank), code,
                f"{label} bank {bank_index} is incomplete")
        bank_id = stable_id(bank.get("id"), f"{label} bank {bank_index} id")
        require(bank_id > previous_bank_id, code,
                f"{label} banks must be ordered by id without duplicates")
        previous_bank_id = bank_id
        bank_ids.add(bank_id)
        entry_frame = as_int(bank.get("entryFrame"), code,
                             f"{label} bank {bank_id} entry frame", 1)
        require(entry_frame <= frame_count and entry_frame not in entry_frames, code,
                f"{label} bank {bank_id} entry frame is invalid or duplicated")
        entry_frames.add(entry_frame)
        bank_timeline = validate_timeline(bank.get("timeline"),
                                          f"{label} bank {bank_id} timeline",
                                          False, entry_frame)
        timeline_tick_count += len(bank_timeline["frames"])
        bank_profiles = None
        if "profileTimelines" in bank:
            values = bank["profileTimelines"]
            require(isinstance(values, list) and 0 < len(values) <= 16, code,
                    f"{label} bank {bank_id} profile timelines are missing or excessive")
            bank_profiles = []
            profile_ids: set[str] = set()
            for profile_index, profile_value in enumerate(values):
                profile = validate_timeline(
                    profile_value,
                    f"{label} bank {bank_id} profile timeline {profile_index}",
                    True, entry_frame)
                profile_id = profile["profileId"]
                require(profile_id not in profile_ids, code,
                        f"{label} bank {bank_id} profile timeline id {profile_id} is duplicated")
                profile_ids.add(profile_id)
                bank_profiles.append(profile)
                timeline_tick_count += len(profile["frames"])
        require(timeline_tick_count <= limits["timeline_ticks"], "TIMELINE_LIMIT",
                f"{label} bank timelines exceed the aggregate tick limit")
        if bank_id == initial_bank_id:
            initial_bank = {**bank, "timeline": bank_timeline}
            if bank_profiles is not None:
                initial_bank["profileTimelines"] = bank_profiles
    require(initial_bank_id in bank_ids and initial_bank is not None
            and initial_bank["entryFrame"] == initial_source, code,
            f"{label} initial bank is missing or does not own the canonical initial frame")
    require(same_playback_timeline(initial_bank["timeline"], timeline), code,
            f"{label} initial bank timeline does not match the canonical top-level timeline")
    top_profiles = packet.get("profileTimelines", [])
    initial_profiles = initial_bank.get("profileTimelines", [])
    require(len(initial_profiles) == len(top_profiles)
            and all(same_playback_timeline(profile, top_profiles[index], True)
                    for index, profile in enumerate(initial_profiles)), code,
            f"{label} initial bank profile timelines do not match the canonical top-level profile timelines")
    return timeline_tick_count


def validate_playback_contract(state_channel: dict, binding: dict,
                               binding_inputs: dict[str, dict],
                               limits: dict[str, int]) -> dict:
    code = "INVALID_PLAYBACK_STATE"
    exact_array(binding.get("inputs"), ["time.tick"], "INVALID_PLAYBACK_BINDING",
                "Playback inputs are incomplete or noncanonical")
    tick_input = binding_inputs.get("time.tick", {})
    require(tick_input.get("type") == "uint" and "default" not in tick_input,
            "INVALID_PLAYBACK_BINDING",
            "Playback time.tick input must be uint without a package default")
    exact_array(binding.get("sinks"), ["style.transform", "style.visibility"],
                "INVALID_PLAYBACK_BINDING", "Playback sinks are incomplete or noncanonical")
    targets = strict_keys(binding.get("targets"), {"model", "shapes", "leaves"},
                          "INVALID_PLAYBACK_BINDING", "playback targets")
    require(set(targets) == {"model", "shapes", "leaves"},
            "INVALID_PLAYBACK_BINDING", "Playback targets are incomplete")
    stable_id(targets.get("model"), "playback model target")
    shapes = unique_targets(targets.get("shapes"), limits["nodes"],
                            "INVALID_PLAYBACK_BINDING", "playback shape")
    leaves = unique_targets(targets.get("leaves"), min(limits["nodes"], 0x10000),
                            "INVALID_PLAYBACK_BINDING", "playback leaf")
    parameters = strict_keys(binding.get("parameters"), {"baseSceneTransform", "frameCount", "tickRateHz", "tickIntervalUs", "catchUpPolicy"},
                             "INVALID_PLAYBACK_BINDING", "playback parameters")
    require({"baseSceneTransform", "frameCount"} <= set(parameters),
            "INVALID_PLAYBACK_BINDING", "Playback parameters are incomplete")
    safe_style(parameters.get("baseSceneTransform"), "Playback base scene transform")
    frame_count = as_int(parameters.get("frameCount"), "FRAME_CARDINALITY_MISMATCH",
                         "playback frameCount", 1)
    require(frame_count <= limits["frames"], "FRAME_CARDINALITY_MISMATCH",
            "Playback frameCount is excessive")
    validate_tick_cadence(parameters, "INVALID_PLAYBACK_BINDING", "Playback")
    require(parameters.get("catchUpPolicy") in (None, "bounded", "single-step", "elapsed"),
            "INVALID_PLAYBACK_BINDING", "Playback catchUpPolicy is invalid")

    data = strict_keys(state_channel.get("data"), {"packet", "leafFit"}, code,
                       "playback state data")
    require(set(data) == {"packet", "leafFit"}, code, "Playback state data is incomplete")
    packet = strict_keys(data.get("packet"), {
        "version", "layout", "shapeCount", "leafCount", "appearances", "timeline",
        "profileTimelines", "initialBankId", "banks", "initial", "frameRows", "shapeChanges", "leafChanges", "transforms",
    }, code, "playback packet")
    require(set(packet) - {"profileTimelines", "initialBankId", "banks"} == {
        "version", "layout", "shapeCount", "leafCount", "appearances", "timeline",
        "initial", "frameRows", "shapeChanges", "leafChanges", "transforms",
    }, code, "Playback packet is incomplete")
    require(as_int(packet.get("version"), code, "playback version") == 0
            and packet.get("layout") == "delta-component-streams@0",
            code, "Playback packet version or layout is unsupported")
    shape_count = as_int(packet.get("shapeCount"), "TARGET_CARDINALITY_MISMATCH",
                         "playback shapeCount")
    leaf_count = as_int(packet.get("leafCount"), "TARGET_CARDINALITY_MISMATCH",
                        "playback leafCount")
    require(shape_count <= limits["nodes"] and leaf_count <= min(limits["nodes"], 0x10000),
            "TARGET_CARDINALITY_MISMATCH", "Playback target count is excessive")
    require(len(shapes) == shape_count and len(leaves) == leaf_count,
            "TARGET_CARDINALITY_MISMATCH", "Playback targets do not match declared counts")
    require(leaf_count * frame_count <= limits["visibility_cells"],
            "VISIBILITY_ALLOCATION_LIMIT", "Playback visibility matrix is excessive")

    leaf_fit = data.get("leafFit")
    require(isinstance(leaf_fit, list) and len(leaf_fit) == leaf_count,
            "TARGET_CARDINALITY_MISMATCH", "Playback leafFit does not match leafCount")
    for index, fit in enumerate(leaf_fit):
        fit = strict_keys(fit, {"canonicalSize"}, code, f"playback leafFit {index}")
        require(set(fit) == {"canonicalSize"}
                and is_safe_int(fit.get("canonicalSize"), 1, 0xffff),
                code, f"Playback leafFit {index} is invalid")

    appearances = packet.get("appearances")
    require(isinstance(appearances, list) and 0 < len(appearances) <= limits["frames"],
            code, "Playback appearances are missing or excessive")
    appearance_ids = set()
    for index, appearance in enumerate(appearances):
        require(isinstance(appearance, list) and len(appearance) == 3,
                code, f"Playback appearance {index} is malformed")
        aid = stable_id(appearance[0], f"playback appearance {index} id")
        require(aid not in appearance_ids, code, f"Playback appearance {aid} is duplicated")
        appearance_ids.add(aid)
        require(finite_f32(appearance[1]) and appearance[1] > 0
                and finite_f32(appearance[2]), code,
                f"Playback appearance {index} values are invalid")

    transforms = strict_keys(packet.get("transforms"), {"count", "groups"}, code,
                             "playback transform table")
    require(set(transforms) == {"count", "groups"}, code,
            "Playback transform table is incomplete")
    transform_count = as_int(transforms.get("count"), "TRANSFORM_ALLOCATION_LIMIT",
                             "playback transform count", 1)
    require(transform_count <= limits["prepared_transforms"], "TRANSFORM_ALLOCATION_LIMIT",
            "Playback transform count is excessive")
    groups = transforms.get("groups")
    require(isinstance(groups, list) and len(groups) <= limits["nodes"],
            "TRANSFORM_ALLOCATION_LIMIT", "Playback transform groups are excessive")

    initial = strict_keys(packet.get("initial"),
                          {"sourceFrame", "appearance", "modelTransform", "shapes", "leaves"},
                          code, "playback initial state")
    require(set(initial) == {"sourceFrame", "appearance", "modelTransform", "shapes", "leaves"},
            code, "Playback initial state is incomplete")
    initial_source = as_int(initial.get("sourceFrame"), "FRAME_CARDINALITY_MISMATCH",
                            "playback initial sourceFrame", 1)
    require(initial_source <= frame_count, "FRAME_CARDINALITY_MISMATCH",
            "Playback initial source frame is invalid")
    initial_appearance = as_int(initial.get("appearance"), code,
                                "playback initial appearance")
    require(initial_appearance < len(appearances), code,
            "Playback initial appearance is invalid")
    initial_model = as_int(initial.get("modelTransform"), code,
                           "playback initial model transform")
    require(initial_model < transform_count, code,
            "Playback initial model transform is invalid")
    initial_shapes = strict_keys(initial.get("shapes"), {"count", "transforms", "visibility"},
                                 code, "playback initial shapes")
    require(set(initial_shapes) == {"count", "transforms", "visibility"}
            and initial_shapes.get("count") == shape_count,
            "TARGET_CARDINALITY_MISMATCH", "Playback initial shapes do not match shapeCount")
    initial_shape_transforms = cumulative_references(
        initial_shapes.get("transforms"), shape_count, code, "playback initial shape transforms")
    shape_visibility = integer_array(initial_shapes.get("visibility"), shape_count, code,
                                     "playback initial shape visibility", 0, 1)
    require(len(shape_visibility) == shape_count, "TARGET_CARDINALITY_MISMATCH",
            "Playback initial shape visibility does not match shapeCount")
    initial_leaves = strict_keys(initial.get("leaves"), {"count", "transforms"},
                                 code, "playback initial leaves")
    require(set(initial_leaves) == {"count", "transforms"}
            and initial_leaves.get("count") == leaf_count,
            "TARGET_CARDINALITY_MISMATCH", "Playback initial leaves do not match leafCount")
    initial_leaf_transforms = cumulative_references(
        initial_leaves.get("transforms"), leaf_count, code, "playback initial leaf transforms")
    require(all(index < transform_count
                for index in initial_shape_transforms + initial_leaf_transforms),
            code, "Playback initial state references a missing transform")

    def validate_timeline(value: Any, label: str, profile: bool,
                          entry_frame: int = initial_source) -> dict:
        fields = {"introTicks", "loopTicks", "frames"}
        if profile:
            fields.add("profileId")
        timeline = strict_keys(value, fields | {"deadlineMicros"}, code, label)
        require(fields <= set(timeline), code, f"{label} is incomplete")
        if profile:
            stable_id(timeline.get("profileId"), f"{label} profile id")
        intro_ticks = as_int(timeline.get("introTicks"), "TIMELINE_LIMIT",
                             f"{label} introTicks")
        loop_ticks = as_int(timeline.get("loopTicks"), "TIMELINE_LIMIT",
                            f"{label} loopTicks", 1)
        timeline_frames = integer_array(timeline.get("frames"), limits["timeline_ticks"],
                                        "TIMELINE_LIMIT", f"{label} frames", 1, frame_count)
        require(len(timeline_frames) == intro_ticks + loop_ticks and timeline_frames
                and timeline_frames[0] == entry_frame,
                "TIMELINE_LIMIT", f"{label} coverage is invalid")
        def frame_distance(source: int, target: int) -> int:
            return (target - source + frame_count) % frame_count
        require(all(frame_distance(timeline_frames[index - 1], timeline_frames[index]) <= 8
                    for index in range(1, len(timeline_frames)))
                and frame_distance(timeline_frames[-1], timeline_frames[intro_ticks]) <= 8,
                "TIMELINE_LIMIT", f"{label} advances too many source frames in one logical tick")
        if "deadlineMicros" in timeline:
            deadlines = integer_array(timeline["deadlineMicros"], limits["timeline_ticks"] + 1,
                                      "TIMELINE_LIMIT", f"{label} deadlines", 0)
            require(len(deadlines) == len(timeline_frames) + 1 and deadlines[0] == 0
                    and all(deadlines[index] > deadlines[index - 1]
                            and deadlines[index] - deadlines[index - 1] <= 2_147_483_647_000
                            for index in range(1, len(deadlines))),
                    "TIMELINE_LIMIT", f"{label} deadlines are incomplete or unordered")
        return timeline

    timeline = validate_timeline(packet.get("timeline"), "Playback timeline", False)
    timeline_tick_count = len(timeline["frames"])
    if "profileTimelines" in packet:
        profile_timelines = packet["profileTimelines"]
        require(isinstance(profile_timelines, list) and 0 < len(profile_timelines) <= 16,
                code, "Playback profile timelines are missing or excessive")
        profile_ids = set()
        for index, value in enumerate(profile_timelines):
            profile_timeline = validate_timeline(
                value, f"Playback profile timeline {index}", True)
            profile_id = profile_timeline["profileId"]
            require(profile_id not in profile_ids, code,
                    f"Playback profile timeline id {profile_id} is duplicated")
            profile_ids.add(profile_id)
            timeline_tick_count += len(profile_timeline["frames"])
            require(timeline_tick_count <= limits["timeline_ticks"], "TIMELINE_LIMIT",
                    "Playback baseline and profile timelines exceed the aggregate tick limit")
    timeline_tick_count = validate_playback_banks(
        packet, initial_source, frame_count, validate_timeline, timeline,
        timeline_tick_count, limits, code, "Playback")

    shape_changes = strict_keys(packet.get("shapeChanges"),
                                {"sources", "transforms", "visibility"}, code,
                                "playback shape changes")
    leaf_changes = strict_keys(packet.get("leafChanges"), {"sources", "transforms"},
                               code, "playback leaf changes")
    require(set(shape_changes) == {"sources", "transforms", "visibility"}
            and set(leaf_changes) == {"sources", "transforms"}, code,
            "Playback change tables are incomplete")
    shape_sources = integer_array(shape_changes.get("sources"), limits["prepared_changes"],
                                  "STATE_CHANGE_LIMIT", "playback shape sources")
    shape_transforms = integer_array(shape_changes.get("transforms"), limits["prepared_changes"],
                                     "STATE_CHANGE_LIMIT", "playback shape transform deltas")
    shape_visibility_changes = integer_array(
        shape_changes.get("visibility"), limits["prepared_changes"],
        "STATE_CHANGE_LIMIT", "playback shape visibility", 0, 1)
    leaf_sources = integer_array(leaf_changes.get("sources"), limits["prepared_changes"],
                                 "STATE_CHANGE_LIMIT", "playback leaf sources")
    leaf_transforms = integer_array(leaf_changes.get("transforms"), limits["prepared_changes"],
                                    "STATE_CHANGE_LIMIT", "playback leaf transform deltas")
    require(len(shape_sources) == len(shape_transforms) == len(shape_visibility_changes)
            and len(leaf_sources) == len(leaf_transforms), "STATE_COLUMN_MISMATCH",
            "Playback change-table columns have unequal lengths")

    rows = packet.get("frameRows")
    require(isinstance(rows, list) and len(rows) == frame_count,
            "FRAME_CARDINALITY_MISMATCH", "Playback frame rows do not match frameCount")
    owners: list[str | None] = [None] * transform_count

    def claim(index: int, owner: str, label: str) -> None:
        require(is_safe_int(index, 0, transform_count - 1), code,
                f"{label} references a missing transform")
        old = owners[int(index)]
        require(old is None or old == owner
                or (old.startswith("shape:") and owner.startswith("shape:")),
                "TRANSFORM_GROUP_MISMATCH", f"{label} aliases incompatible owners")
        if old is None:
            owners[int(index)] = owner

    claim(initial_model, "model", "playback initial model")
    for index, transform in enumerate(initial_shape_transforms):
        claim(transform, f"shape:{index}", f"playback initial shape {index}")
    for index, transform in enumerate(initial_leaf_transforms):
        claim(transform, f"leaf:{index}", f"playback initial leaf {index}")
    shape_cursor = leaf_cursor = shape_transform = leaf_transform = 0
    for index, row in enumerate(rows):
        require(isinstance(row, list) and len(row) == 7
                and all(is_safe_int(value) for value in row) and int(row[0]) == index + 1,
                "INVALID_FRAME_ROW", f"Playback frame row {index} is malformed")
        row = [int(value) for value in row]
        require(0 <= row[1] < len(appearances), "INVALID_FRAME_ROW",
                f"Playback frame row {index} appearance is invalid")
        require(row[2] == -1 or 0 <= row[2] < transform_count, "INVALID_FRAME_ROW",
                f"Playback frame row {index} model transform is invalid")
        if row[2] != -1:
            claim(row[2], "model", f"playback frame row {index} model")
        require(row[3] == shape_cursor and row[4] >= 0
                and row[3] + row[4] <= len(shape_sources), "STATE_COLUMN_MISMATCH",
                f"Playback frame row {index} shape range is noncanonical")
        shape = 0
        for cursor in range(row[3], row[3] + row[4]):
            shape += shape_sources[cursor]
            shape_transform += shape_transforms[cursor]
            require(0 <= shape < shape_count, "STATE_COLUMN_MISMATCH",
                    f"Playback frame row {index} shape index is invalid")
            claim(shape_transform, f"shape:{shape}",
                  f"playback frame row {index} shape {shape}")
        shape_cursor += row[4]
        require(row[5] == leaf_cursor and row[6] >= 0
                and row[5] + row[6] <= len(leaf_sources), "STATE_COLUMN_MISMATCH",
                f"Playback frame row {index} leaf range is noncanonical")
        leaf = 0
        for cursor in range(row[5], row[5] + row[6]):
            leaf += leaf_sources[cursor]
            leaf_transform += leaf_transforms[cursor]
            require(0 <= leaf < leaf_count, "STATE_COLUMN_MISMATCH",
                    f"Playback frame row {index} leaf index is invalid")
            claim(leaf_transform, f"leaf:{leaf}",
                  f"playback frame row {index} leaf {leaf}")
        leaf_cursor += row[6]
    require(shape_cursor == len(shape_sources) and leaf_cursor == len(leaf_sources),
            "STATE_COLUMN_MISMATCH", "Playback change tables have unreferenced rows")
    require(all(owner is not None for owner in owners), "TRANSFORM_GROUP_MISMATCH",
            "Playback transform table has unowned rows")

    inferred: dict[str, list[int]] = {}
    for index, owner in enumerate(owners):
        inferred.setdefault(str(owner), []).append(index)
    require(len(groups) == len(inferred), "TRANSFORM_GROUP_MISMATCH",
            "Playback transform groups do not match inferred owners")
    for group_index, ((owner, indices), group) in enumerate(zip(inferred.items(), groups)):
        group = strict_keys(group, {"encoding", "empty", "scales", "columns"}, code,
                            f"playback transform group {group_index}")
        require(set(group) == {"encoding", "empty", "scales", "columns"}, code,
                f"Playback transform group {group_index} is incomplete")
        encoding = group.get("encoding")
        require(encoding in ("decimal-component-streams", "source-milli-fitted-leaf"),
                code, f"Playback transform group {group_index} encoding is unsupported")
        require(encoding != "source-milli-fitted-leaf" or owner.startswith("leaf:"),
                "TRANSFORM_GROUP_MISMATCH", "Playback fitted transform has a non-leaf owner")
        empty = integer_array(group.get("empty"), len(indices), code,
                              f"playback transform group {group_index} empty rows",
                              0, max(0, len(indices) - 1), True)
        require(all(empty[position - 1] < value
                    for position, value in enumerate(empty) if position > 0), code,
                f"Playback transform group {group_index} empty rows are unsorted")
        scales = integer_array(group.get("scales"), 12, code,
                               f"playback transform group {group_index} scales", 0)
        require(len(scales) == 12, code,
                f"Playback transform group {group_index} scales are invalid")
        require(encoding != "source-milli-fitted-leaf" or all(scale == 1000 for scale in scales),
                code, f"Playback fitted transform group {group_index} has invalid scales")
        columns = group.get("columns")
        present_count = len(indices) - len(empty)
        require(isinstance(columns, list) and len(columns) == 12, code,
                f"Playback transform group {group_index} must have 12 columns")
        for column_index, column in enumerate(columns):
            require(isinstance(column, list) and len(column) == present_count
                    and all(not isinstance(value, bool) and isinstance(value, (int, float))
                            and math.isfinite(value) for value in column), code,
                    f"Playback transform group {group_index} column {column_index} is invalid")
            if scales[column_index] > 0:
                current = 0
                for delta in column:
                    require(is_safe_int(delta), code,
                            f"Playback scaled column {column_index} contains a noninteger delta")
                    current += int(delta)
                    require(is_safe_int(current) and math.isfinite(current / scales[column_index]),
                            code, f"Playback scaled column {column_index} overflows")
    return packet


def validate_paged_playback_contract(state_channel: dict, binding: dict,
                                      binding_inputs: dict[str, dict],
                                      limits: dict[str, int]) -> dict:
    code = "INVALID_PAGED_PLAYBACK_STATE"
    tick = binding_inputs.get("time.tick", {})
    require(tick.get("type") == "uint" and "default" not in tick,
            "INVALID_PLAYBACK_BINDING", "Paged playback time.tick must be an un-defaulted uint")
    targets = strict_keys(binding.get("targets"), {"model", "shapes", "leaves"},
                          "INVALID_PLAYBACK_BINDING", "paged playback targets")
    require(set(targets) == {"model", "shapes", "leaves"}, "INVALID_PLAYBACK_BINDING",
            "Paged playback targets are incomplete")
    stable_id(targets.get("model"), "paged playback model target")
    shapes = unique_targets(targets.get("shapes"), limits["nodes"],
                            "INVALID_PLAYBACK_BINDING", "paged playback shape")
    leaves = unique_targets(targets.get("leaves"), min(limits["nodes"], 0x10000),
                            "INVALID_PLAYBACK_BINDING", "paged playback leaf")
    parameters = strict_keys(binding.get("parameters"),
                             {"baseSceneTransform", "frameCount", "tickRateHz", "tickIntervalUs", "catchUpPolicy"},
                             "INVALID_PLAYBACK_BINDING", "paged playback parameters")
    require({"baseSceneTransform", "frameCount"} <= set(parameters),
            "INVALID_PLAYBACK_BINDING", "Paged playback parameters are incomplete")
    safe_style(parameters.get("baseSceneTransform"), "Paged playback base scene transform")
    frame_count = as_int(parameters.get("frameCount"), "FRAME_CARDINALITY_MISMATCH",
                         "paged playback frameCount", 1)
    require(frame_count <= limits["paged_frames"], "FRAME_CARDINALITY_MISMATCH",
            "Paged playback frame count is invalid")
    validate_tick_cadence(parameters, "INVALID_PLAYBACK_BINDING", "Paged playback")
    require(parameters.get("catchUpPolicy") in (None, "bounded", "single-step", "elapsed"),
            "INVALID_PLAYBACK_BINDING", "Paged playback catchUpPolicy is invalid")
    data = strict_keys(state_channel.get("data"), {"packet"}, code, "paged playback state")
    require(set(data) == {"packet"}, code, "Paged playback state is incomplete")
    packet_fields = {"version", "shapeCount", "leafCount", "appearances", "timeline",
                     "profileTimelines", "initialBankId", "banks", "initial", "pages", "lookaheadPages", "maxResidentPages"}
    packet = strict_keys(data.get("packet"), packet_fields, code, "paged playback packet")
    require(set(packet) - {"profileTimelines", "initialBankId", "banks"}
            == packet_fields - {"profileTimelines", "initialBankId", "banks"},
            code, "Paged playback packet is incomplete")
    require(as_int(packet.get("version"), code, "paged playback version") == 0,
            code, "Paged playback version must be zero")
    shape_count = as_int(packet.get("shapeCount"), "TARGET_CARDINALITY_MISMATCH",
                         "paged playback shapeCount")
    leaf_count = as_int(packet.get("leafCount"), "TARGET_CARDINALITY_MISMATCH",
                        "paged playback leafCount")
    require(shape_count <= limits["nodes"] and leaf_count <= min(limits["nodes"], 0x10000)
            and len(shapes) == shape_count and len(leaves) == leaf_count,
            "TARGET_CARDINALITY_MISMATCH", "Paged playback targets do not match declared counts")
    appearances = packet.get("appearances")
    require(isinstance(appearances, list) and 0 < len(appearances) <= limits["frames"],
            code, "Paged playback appearances are missing or excessive")
    appearance_ids = set()
    for index, appearance in enumerate(appearances):
        require(isinstance(appearance, list) and len(appearance) == 3,
                code, f"Paged playback appearance {index} is malformed")
        aid = stable_id(appearance[0], f"paged playback appearance {index} id")
        require(aid not in appearance_ids and finite_f32(appearance[1]) and appearance[1] > 0
                and finite_f32(appearance[2]), code,
                f"Paged playback appearance {index} is invalid")
        appearance_ids.add(aid)
    initial = strict_keys(packet.get("initial"), {"sourceFrame", "appearance"}, code,
                          "paged playback initial")
    initial_frame = as_int(initial.get("sourceFrame"), "FRAME_CARDINALITY_MISMATCH",
                           "paged playback initial frame", 1)
    initial_appearance = as_int(initial.get("appearance"), code,
                                "paged playback initial appearance")
    require(initial_frame <= frame_count and initial_appearance < len(appearances), code,
            "Paged playback initial state is invalid")

    def validate_timeline(value: Any, label: str, profile: bool,
                          entry_frame: int = initial_frame) -> dict:
        fields = {"introTicks", "loopTicks", "frames"} | ({"profileId"} if profile else set())
        timeline = strict_keys(value, fields | {"deadlineMicros"}, code, label)
        require(fields <= set(timeline), code, f"{label} is incomplete")
        if profile:
            stable_id(timeline.get("profileId"), f"{label} profile id")
        intro = as_int(timeline.get("introTicks"), "TIMELINE_LIMIT", f"{label} introTicks")
        loop = as_int(timeline.get("loopTicks"), "TIMELINE_LIMIT", f"{label} loopTicks", 1)
        frames = integer_array(timeline.get("frames"), limits["timeline_ticks"],
                               "TIMELINE_LIMIT", f"{label} frames", 1, frame_count)
        require(len(frames) == intro + loop and frames and frames[0] == entry_frame,
                "TIMELINE_LIMIT", f"{label} coverage is invalid")
        def frame_distance(source: int, target: int) -> int:
            return (target - source + frame_count) % frame_count
        require(all(frame_distance(frames[index - 1], frames[index]) <= 8
                    for index in range(1, len(frames)))
                and frame_distance(frames[-1], frames[intro]) <= 8,
                "TIMELINE_LIMIT", f"{label} advances too many source frames in one logical tick")
        if "deadlineMicros" in timeline:
            deadlines = integer_array(timeline["deadlineMicros"], limits["timeline_ticks"] + 1,
                                      "TIMELINE_LIMIT", f"{label} deadlines", 0)
            require(len(deadlines) == len(frames) + 1 and deadlines[0] == 0
                    and all(deadlines[index] > deadlines[index - 1]
                            and deadlines[index] - deadlines[index - 1] <= 2_147_483_647_000
                            for index in range(1, len(deadlines))),
                    "TIMELINE_LIMIT", f"{label} deadlines are incomplete or unordered")
        return timeline

    timeline = validate_timeline(packet.get("timeline"), "Paged playback timeline", False)
    ticks = len(timeline["frames"])
    if "profileTimelines" in packet:
        profiles = packet["profileTimelines"]
        require(isinstance(profiles, list) and 0 < len(profiles) <= 16, code,
                "Paged playback profile timelines are missing or excessive")
        profile_ids = set()
        for index, value in enumerate(profiles):
            timeline = validate_timeline(value, f"Paged playback profile timeline {index}", True)
            require(timeline["profileId"] not in profile_ids, code,
                    "Paged playback profile timeline id is duplicated")
            profile_ids.add(timeline["profileId"])
            ticks += len(timeline["frames"])
            require(ticks <= limits["timeline_ticks"], "TIMELINE_LIMIT",
                    "Paged playback timelines exceed the aggregate tick limit")
    ticks = validate_playback_banks(
        packet, initial_frame, frame_count, validate_timeline, timeline,
        ticks, limits, code, "Paged playback")
    lookahead = as_int(packet.get("lookaheadPages"), "STATE_PAGE_RESIDENCY_LIMIT",
                       "paged playback lookahead", 1)
    resident = as_int(packet.get("maxResidentPages"), "STATE_PAGE_RESIDENCY_LIMIT",
                      "paged playback residency", 1)
    require(lookahead <= 4 and lookahead + 1 <= resident <= 16,
            "STATE_PAGE_RESIDENCY_LIMIT", "Paged playback residency is invalid")
    pages = packet.get("pages")
    require(isinstance(pages, list) and 0 < len(pages) <= limits["state_pages"],
            "STATE_PAGE_COVERAGE_MISMATCH", "Paged playback pages are missing or excessive")
    resources, expected = set(), 1
    fields = {"resource", "startFrame", "endFrame", "transformCount", "shapeChangeCount",
              "leafChangeCount", "materializedByteLength"}
    for index, page in enumerate(pages):
        page = strict_keys(page, fields, code, f"paged playback page {index}")
        require(set(page) == fields, code, f"Paged playback page {index} is incomplete")
        resource = resource_id(page.get("resource"), f"paged playback page {index} resource")
        start = as_int(page.get("startFrame"), "STATE_PAGE_COVERAGE_MISMATCH", "page start", 1)
        end = as_int(page.get("endFrame"), "STATE_PAGE_COVERAGE_MISMATCH", "page end", 1)
        transforms = as_int(page.get("transformCount"), "TRANSFORM_ALLOCATION_LIMIT", "page transforms", 1)
        shape_changes = as_int(page.get("shapeChangeCount"), "STATE_CHANGE_LIMIT", "page shape changes")
        leaf_changes = as_int(page.get("leafChangeCount"), "STATE_CHANGE_LIMIT", "page leaf changes")
        materialized = as_int(page.get("materializedByteLength"), "STATE_PAGE_RESIDENCY_LIMIT",
                              "page materialized bytes", 1)
        require(resource not in resources and start == expected and start <= end <= frame_count,
                "STATE_PAGE_COVERAGE_MISMATCH", f"Paged playback page {index} is noncontiguous")
        require(end - start + 1 <= limits["state_page_frames"],
                "STATE_PAGE_COVERAGE_MISMATCH",
                f"Paged playback page {index} exceeds the per-page frame limit")
        require(transforms <= limits["prepared_transforms"]
                and shape_changes <= limits["prepared_changes"]
                and leaf_changes <= limits["prepared_changes"]
                and materialized <= limits["decoded_total"], "STATE_PAGE_TABLE_LIMIT",
                f"Paged playback page {index} tables are excessive")
        resources.add(resource); expected = end + 1
    require(expected == frame_count + 1, "STATE_PAGE_COVERAGE_MISMATCH",
            "Paged playback pages do not cover playback exactly")
    return packet


def validate_surface_contract(state_channel: dict, binding: dict,
                              playback_packet: dict, playback_binding: dict,
                              binding_inputs: dict[str, dict],
                              limits: dict[str, int]) -> dict:
    code = "INVALID_SURFACE_STATE"
    exact_array(binding.get("inputs"), ["time.source-frame"], "INVALID_SURFACE_BINDING",
                "Surface inputs are incomplete or noncanonical")
    source_frame_input = binding_inputs.get("time.source-frame", {})
    require(source_frame_input.get("type") == "uint" and "default" not in source_frame_input,
            "INVALID_SURFACE_BINDING",
            "Surface time.source-frame input must be uint without a package default")
    require("parameters" not in binding, "INVALID_SURFACE_BINDING",
            "Surface binding must not declare parameters")
    targets = strict_keys(binding.get("targets"), {"leaves"},
                          "INVALID_SURFACE_BINDING", "surface targets")
    require(set(targets) == {"leaves"}, "INVALID_SURFACE_BINDING",
            "Surface targets are incomplete")
    leaves = unique_targets(targets.get("leaves"), min(limits["nodes"], 0x10000),
                            "INVALID_SURFACE_BINDING", "surface leaf")
    playback_leaves = playback_binding["targets"]["leaves"]
    leaf_count = int(playback_packet["leafCount"])
    require(leaves == playback_leaves and len(leaves) == leaf_count,
            "TARGET_CARDINALITY_MISMATCH",
            "Surface leaves must exactly match playback leaves")

    data = strict_keys(state_channel.get("data"), {"packet"}, code, "surface state data")
    require(set(data) == {"packet"}, code, "Surface state data is incomplete")
    packet = strict_keys(data.get("packet"),
                         {"version", "frameCount", "surface", "transitions", "visibility"},
                         code, "surface packet")
    require(set(packet) == {"version", "frameCount", "surface", "transitions", "visibility"},
            code, "Surface packet is incomplete")
    frame_count = int(playback_binding["parameters"]["frameCount"])
    require(as_int(packet.get("version"), "FRAME_CARDINALITY_MISMATCH", "surface version") == 0
            and packet.get("frameCount") == frame_count,
            "FRAME_CARDINALITY_MISMATCH", "Surface version or frameCount is invalid")

    surface = strict_keys(packet.get("surface"), {"faces", "statePacking"},
                          code, "surface table")
    require(set(surface) == {"faces", "statePacking"}, code,
            "Surface table is incomplete")
    faces = surface.get("faces")
    require(isinstance(faces, list) and len(faces) == leaf_count,
            "TARGET_CARDINALITY_MISMATCH", "Surface faces do not match leafCount")
    packing = strict_keys(surface.get("statePacking"), {"stateCount", "sourceFrameDeltas", "positionDictionary", "positionIndicesBase64"},
                          code, "surface state packing")
    require({"stateCount", "sourceFrameDeltas"}.issubset(packing), code,
            "Surface state packing is incomplete")
    state_count = as_int(packing.get("stateCount"), "SURFACE_STATE_LIMIT",
                         "surface stateCount")
    require(state_count <= limits["prepared_states"], "SURFACE_STATE_LIMIT",
            "Surface stateCount is excessive")
    source_deltas = integer_array(packing.get("sourceFrameDeltas"),
                                  limits["prepared_states"], "SURFACE_STATE_LIMIT",
                                  "surface source-frame deltas", 0, max(0, frame_count - 1))
    require(len(source_deltas) == state_count, "STATE_COLUMN_MISMATCH",
            "Surface source-frame deltas do not match stateCount")
    has_position_dictionary = "positionDictionary" in packing
    has_position_indices = "positionIndicesBase64" in packing
    require(has_position_dictionary == has_position_indices, code,
            "Surface prepared position dictionary and indices must appear together")
    prepared_positions = has_position_dictionary
    exact_array(binding.get("sinks"),
                ["style.backgroundPosition" if prepared_positions else "style.backgroundPositionY",
                 "style.visibility"],
                "INVALID_SURFACE_BINDING", "Surface sinks are incomplete or noncanonical")
    if prepared_positions:
        dictionary = packing.get("positionDictionary")
        require(isinstance(dictionary, list) and 0 < len(dictionary)
                <= min(state_count, 0xffff), "SURFACE_STATE_LIMIT",
                "Surface position dictionary is missing or excessive")
        previous: tuple[int, int] | None = None
        for index, position in enumerate(dictionary):
            require(isinstance(position, list) and len(position) == 2
                    and all(is_safe_int(coordinate, -0x80000000, 0x7fffffff)
                            and not (isinstance(coordinate, float)
                                     and coordinate == 0
                                     and math.copysign(1.0, coordinate) < 0)
                            for coordinate in position), code,
                    f"Surface position dictionary row {index} is invalid")
            current = (int(position[0]), int(position[1]))
            require(previous is None or current > previous, code,
                    "Surface position dictionary is not strictly lexicographically sorted")
            previous = current
        position_indices = base64_integers(packing.get("positionIndicesBase64"), 2,
                                           limits["prepared_states"], code,
                                           "surface position indices")
        require(len(position_indices) == state_count
                and all(position < len(dictionary) for position in position_indices),
                "STATE_COLUMN_MISMATCH",
                "Surface position indices do not match the state table or dictionary")
        require(len(set(position_indices)) == len(dictionary), code,
                "Surface position dictionary contains an unreferenced row")
    face_ids, state_offset = set(), 0
    source_frames_by_face: list[list[int]] = []
    for index, face in enumerate(faces):
        face = strict_keys(face, {"faceId", "sourceOrder", "stateOffset", "stateCount",
                                  "leafWidth", "leafHeight"}, code, f"surface face {index}")
        require(set(face) == {"faceId", "sourceOrder", "stateOffset", "stateCount",
                              "leafWidth", "leafHeight"}, code,
                f"Surface face {index} is incomplete")
        face_id = stable_id(face.get("faceId"), f"surface face {index} id")
        require(face_id not in face_ids and face.get("sourceOrder") == index,
                code, f"Surface face {index} identity or order is invalid")
        face_ids.add(face_id)
        local_count = as_int(face.get("stateCount"), "STATE_COLUMN_MISMATCH",
                             f"surface face {index} stateCount", 1)
        require(face.get("stateOffset") == state_offset
                and state_offset + local_count <= state_count,
                "STATE_COLUMN_MISMATCH",
                f"Surface face {index} state range is noncanonical")
        require(is_safe_int(face.get("leafWidth"), 1, 0xffff)
                and is_safe_int(face.get("leafHeight"), 1, 0xffff), code,
                f"Surface face {index} dimensions are invalid")
        source_frame = 0
        source_frames: list[int] = []
        for local in range(local_count):
            delta = source_deltas[state_offset + local]
            require(delta == 0 if local == 0 else delta > 0, code,
                    f"Surface face {index} source deltas are noncanonical")
            source_frame += delta
            require(source_frame < frame_count, code,
                    f"Surface face {index} state exceeds frameCount")
            source_frames.append(source_frame)
        source_frames_by_face.append(source_frames)
        state_offset += local_count
    require(state_offset == state_count, "STATE_COLUMN_MISMATCH",
            "Surface state table has unreferenced rows")

    transitions = strict_keys(packet.get("transitions"),
                               {"initialFrame", "sequential", "nonInteractiveJumps"},
                               code, "surface transitions")
    require(set(transitions) == {"initialFrame", "sequential", "nonInteractiveJumps"},
            code, "Surface transitions are incomplete")
    require(transitions.get("initialFrame") == 1
            and transitions.get("initialFrame") == playback_packet["initial"]["sourceFrame"],
            "FRAME_CARDINALITY_MISMATCH",
            "Surface initial frame must be frame 1 and match playback")
    sequential = strict_keys(transitions.get("sequential"),
                             {"offsetsBase64", "faceIndexDeltas", "stateIndexDeltas"},
                             code, "surface sequential transitions")
    require(set(sequential) == {"offsetsBase64", "faceIndexDeltas", "stateIndexDeltas"},
            code, "Surface sequential transitions are incomplete")
    face_deltas = integer_array(sequential.get("faceIndexDeltas"),
                                limits["prepared_changes"], "STATE_CHANGE_LIMIT",
                                "surface face-index deltas", 0,
                                max(0, leaf_count - 1))
    state_deltas = integer_array(sequential.get("stateIndexDeltas"),
                                 limits["prepared_changes"], "STATE_CHANGE_LIMIT",
                                 "surface state-index deltas", 0, 0xffff)
    require(len(face_deltas) == len(state_deltas), "STATE_COLUMN_MISMATCH",
            "Surface transition columns have unequal lengths")
    offsets = base64_integers(sequential.get("offsetsBase64"), 4, frame_count + 1,
                              code, "surface transition offsets")
    require(len(offsets) == frame_count + 1 and offsets[0] == 0
            and offsets[-1] == len(face_deltas)
            and all(offsets[index - 1] <= value
                    for index, value in enumerate(offsets) if index > 0),
            "STATE_COLUMN_MISMATCH", "Surface transition offsets are invalid")
    current_states = [0] * leaf_count
    lighting_segments: list[tuple[list[int], list[int]]] = []
    for frame in range(frame_count):
        face_index, previous_face = 0, -1
        segment_faces: list[int] = []
        segment_states: list[int] = []
        for cursor in range(offsets[frame], offsets[frame + 1]):
            face_index += face_deltas[cursor]
            require(0 <= face_index < len(faces) and face_index > previous_face,
                    code, f"Surface transition segment {frame} has invalid face ordering")
            current_states[face_index] += state_deltas[cursor]
            require(current_states[face_index] < faces[face_index]["stateCount"], code,
                    f"Surface transition segment {frame} exceeds face state count")
            segment_faces.append(face_index)
            segment_states.append(current_states[face_index])
            previous_face = face_index
        lighting_segments.append((segment_faces, segment_states))

    jumps = transitions.get("nonInteractiveJumps")
    require(isinstance(jumps, list) and len(jumps) <= frame_count, code,
            "Surface jumps are invalid or excessive")
    jump_pairs = set()
    lighting_jumps: dict[str, tuple[list[int], list[int]]] = {}
    for index, jump in enumerate(jumps):
        jump = strict_keys(jump,
                           {"fromFrame", "toFrame", "faceIndicesBase64", "stateIndicesBase64"},
                           code, f"surface jump {index}")
        require(set(jump) == {"fromFrame", "toFrame", "faceIndicesBase64", "stateIndicesBase64"},
                code, f"Surface jump {index} is incomplete")
        from_frame = as_int(jump.get("fromFrame"), code, f"surface jump {index} fromFrame", 1)
        to_frame = as_int(jump.get("toFrame"), code, f"surface jump {index} toFrame", 1)
        pair = f"{from_frame}>{to_frame}"
        require(from_frame <= frame_count and to_frame <= frame_count
                and from_frame != to_frame and pair not in jump_pairs,
                code, f"Surface jump {index} frames are invalid or duplicated")
        jump_pairs.add(pair)
        jump_faces = base64_integers(jump.get("faceIndicesBase64"), 2,
                                     leaf_count, code,
                                     f"surface jump {index} faces")
        jump_states = base64_integers(jump.get("stateIndicesBase64"), 2,
                                      leaf_count, code,
                                      f"surface jump {index} states")
        require(len(jump_faces) == len(jump_states)
                and all(face < len(faces)
                        and (cursor == 0 or jump_faces[cursor - 1] < face)
                        and jump_states[cursor] < faces[face]["stateCount"]
                        for cursor, face in enumerate(jump_faces)), code,
                f"Surface jump {index} rows are invalid")
        lighting_jumps[pair] = (jump_faces, jump_states)

    visibility = strict_keys(packet.get("visibility"),
                             {"initialFrame", "initialVisibleBitsBase64", "sequential",
                              "nonInteractiveJumps"}, code, "surface visibility")
    require(set(visibility) == {"initialFrame", "initialVisibleBitsBase64", "sequential",
                                "nonInteractiveJumps"}, code,
            "Surface visibility is incomplete")
    require(visibility.get("initialFrame") == transitions["initialFrame"],
            "FRAME_CARDINALITY_MISMATCH",
            "Surface visibility initial frame is invalid")
    initial_bits = base64_integers(visibility.get("initialVisibleBitsBase64"), 1,
                                   math.ceil(leaf_count / 8), code,
                                   "surface initial visibility bitset")
    require(len(initial_bits) == math.ceil(leaf_count / 8), code,
            "Surface initial visibility bitset is truncated")
    for index in range(leaf_count, len(initial_bits) * 8):
        require(((initial_bits[index >> 3] >> (index & 7)) & 1) == 0, code,
                "Surface visibility bitset has nonzero unused bits")
    visibility_sequential = strict_keys(visibility.get("sequential"),
                                        {"offsetsBase64", "faceIndicesBase64"}, code,
                                        "surface sequential visibility")
    require(set(visibility_sequential) == {"offsetsBase64", "faceIndicesBase64"}, code,
            "Surface sequential visibility is incomplete")
    visibility_offsets = base64_integers(visibility_sequential.get("offsetsBase64"), 4,
                                         frame_count + 1, code,
                                         "surface visibility offsets")
    visibility_faces = base64_integers(visibility_sequential.get("faceIndicesBase64"), 2,
                                       limits["prepared_changes"], code,
                                       "surface visibility faces")
    require(len(visibility_offsets) == frame_count + 1 and visibility_offsets[0] == 0
            and visibility_offsets[-1] == len(visibility_faces)
            and all(visibility_offsets[index - 1] <= value
                    for index, value in enumerate(visibility_offsets) if index > 0),
            "STATE_COLUMN_MISMATCH", "Surface visibility offsets are invalid")
    for frame in range(frame_count):
        for cursor in range(visibility_offsets[frame], visibility_offsets[frame + 1]):
            require(visibility_faces[cursor] < leaf_count
                    and (cursor == visibility_offsets[frame]
                         or visibility_faces[cursor - 1] < visibility_faces[cursor]),
                    code, f"Surface visibility segment {frame} is invalid")
    initial_visibility = bytearray((initial_bits[face_index >> 3]
                                    >> (face_index & 7)) & 1
                                   for face_index in range(leaf_count))
    visibility_jumps = visibility.get("nonInteractiveJumps")
    require(isinstance(visibility_jumps, list) and len(visibility_jumps) <= frame_count,
            code, "Surface visibility jumps are invalid or excessive")
    visibility_pairs = set()
    visibility_jump_rows: dict[str, list[int]] = {}
    for index, jump in enumerate(visibility_jumps):
        jump = strict_keys(jump, {"fromFrame", "toFrame", "faceIndicesBase64"},
                           code, f"surface visibility jump {index}")
        require(set(jump) == {"fromFrame", "toFrame", "faceIndicesBase64"}, code,
                f"Surface visibility jump {index} is incomplete")
        from_frame = as_int(jump.get("fromFrame"), code,
                            f"surface visibility jump {index} fromFrame", 1)
        to_frame = as_int(jump.get("toFrame"), code,
                          f"surface visibility jump {index} toFrame", 1)
        pair = f"{from_frame}>{to_frame}"
        require(from_frame <= frame_count and to_frame <= frame_count
                and from_frame != to_frame and pair not in visibility_pairs,
                code, f"Surface visibility jump {index} is invalid or duplicated")
        visibility_pairs.add(pair)
        jump_faces = base64_integers(jump.get("faceIndicesBase64"), 2,
                                     leaf_count, code,
                                     f"surface visibility jump {index} faces")
        require(all(face < leaf_count
                    and (cursor == 0 or jump_faces[cursor - 1] < face)
                    for cursor, face in enumerate(jump_faces)), code,
                f"Surface visibility jump {index} faces are invalid")
        visibility_jump_rows[pair] = jump_faces
    require(jump_pairs == visibility_pairs, code,
            "Surface lighting and visibility jump pairs differ")

    def state_at(source_frames: list[int], frame_index: int) -> int:
        lower, upper = 0, len(source_frames)
        while lower < upper:
            middle = lower + (upper - lower) // 2
            if source_frames[middle] <= frame_index:
                lower = middle + 1
            else:
                upper = middle
        return lower - 1

    def expected_transition(from_frame: int, to_frame: int,
                            from_visibility: bytearray, to_visibility: bytearray) \
            -> tuple[list[int], list[int], list[int]]:
        changed_visibility: list[int] = []
        changed_faces: list[int] = []
        changed_states: list[int] = []
        for face_index in range(leaf_count):
            from_visible = from_visibility[face_index]
            to_visible = to_visibility[face_index]
            if from_visible != to_visible:
                changed_visibility.append(face_index)
            from_state = state_at(source_frames_by_face[face_index], from_frame - 1)
            to_state = state_at(source_frames_by_face[face_index], to_frame - 1)
            if to_visible == 1 and (from_visible == 0 or from_state != to_state):
                changed_faces.append(face_index)
                changed_states.append(to_state)
        return changed_visibility, changed_faces, changed_states

    endpoint_frames = {int(frame) for pair in jump_pairs for frame in pair.split(">")}
    require(len(endpoint_frames) * max(1, leaf_count) <= limits["visibility_cells"],
            "VISIBILITY_ALLOCATION_LIMIT",
            "Surface jump endpoint visibility rows exceed the allocation limit")
    endpoint_rows: dict[int, bytearray] = {}
    if 1 in endpoint_frames:
        endpoint_rows[1] = bytearray(initial_visibility)
    previous_visibility = bytearray(initial_visibility)
    for to_frame in range(2, frame_count + 1):
        next_visibility = bytearray(previous_visibility)
        for cursor in range(visibility_offsets[to_frame - 1], visibility_offsets[to_frame]):
            next_visibility[visibility_faces[cursor]] ^= 1
        expected_visibility, expected_faces, expected_states = \
            expected_transition(to_frame - 1, to_frame,
                                previous_visibility, next_visibility)
        actual_faces, actual_states = lighting_segments[to_frame - 1]
        actual_visibility = visibility_faces[
            visibility_offsets[to_frame - 1]:visibility_offsets[to_frame]]
        require(actual_faces == expected_faces and actual_states == expected_states,
                "SURFACE_TRANSITION_MISMATCH",
                f"Surface lighting transition {to_frame - 1}>{to_frame} is not closed")
        require(actual_visibility == expected_visibility,
                "SURFACE_TRANSITION_MISMATCH",
                f"Surface visibility transition {to_frame - 1}>{to_frame} is not closed")
        previous_visibility = next_visibility
        if to_frame in endpoint_frames:
            endpoint_rows[to_frame] = bytearray(next_visibility)
    wrapped = bytearray(previous_visibility)
    for cursor in range(visibility_offsets[0], visibility_offsets[1]):
        wrapped[visibility_faces[cursor]] ^= 1
    require(wrapped == initial_visibility, "SURFACE_TRANSITION_MISMATCH",
            "Surface visibility wrap transition does not reproduce frame 1")
    expected_visibility, expected_faces, expected_states = expected_transition(
        frame_count, 1, previous_visibility, initial_visibility)
    actual_faces, actual_states = lighting_segments[0]
    require(actual_faces == expected_faces and actual_states == expected_states,
            "SURFACE_TRANSITION_MISMATCH",
            f"Surface lighting transition {frame_count}>1 is not closed")
    require(visibility_faces[visibility_offsets[0]:visibility_offsets[1]]
            == expected_visibility, "SURFACE_TRANSITION_MISMATCH",
            f"Surface visibility transition {frame_count}>1 is not closed")
    for pair in jump_pairs:
        from_frame, to_frame = (int(value) for value in pair.split(">"))
        expected_visibility, expected_faces, expected_states = \
            expected_transition(from_frame, to_frame,
                                endpoint_rows[from_frame], endpoint_rows[to_frame])
        actual_faces, actual_states = lighting_jumps[pair]
        require(actual_faces == expected_faces and actual_states == expected_states,
                "SURFACE_JUMP_MISMATCH",
                f"Surface lighting jump {pair} contradicts canonical target state")
        require(visibility_jump_rows[pair] == expected_visibility,
                "SURFACE_JUMP_MISMATCH",
                f"Surface visibility jump {pair} contradicts canonical target state")
    return packet


def validate_variants_contract(state_channel: dict, binding: dict,
                               playback_packet: dict, playback_binding: dict,
                               binding_inputs: dict[str, dict],
                               limits: dict[str, int], tree_nodes: list[dict],
                               surface_binding: dict | None) -> dict:
    code = "INVALID_VARIANT_STATE"
    exact_array(binding.get("inputs"), ["time.source-frame"],
                "INVALID_VARIANT_BINDING", "Variant inputs are incomplete or noncanonical")
    source_frame_input = binding_inputs.get("time.source-frame", {})
    require(source_frame_input.get("type") == "uint" and "default" not in source_frame_input,
            "INVALID_VARIANT_BINDING",
            "Variant time.source-frame input must be uint without a package default")
    require("parameters" not in binding, "INVALID_VARIANT_BINDING",
            "Variant binding must not declare parameters")
    targets = strict_keys(binding.get("targets"), {"effectNodes", "nodes"},
                          "INVALID_VARIANT_BINDING", "variant targets")
    require(set(targets) == {"effectNodes", "nodes"}, "INVALID_VARIANT_BINDING",
            "Variant targets are incomplete")
    nodes = unique_targets(targets.get("nodes"), min(limits["nodes"], 0xffff),
                           "INVALID_VARIANT_BINDING", "variant node")
    effect_nodes = unique_targets(targets.get("effectNodes"), min(limits["nodes"], 0xfffe),
                                  "INVALID_VARIANT_BINDING", "variant effect node")
    require(nodes, "TARGET_CARDINALITY_MISMATCH", "Variant targets are empty")

    data = strict_keys(state_channel.get("data"), {"packet"}, code, "variant state data")
    require(set(data) == {"packet"}, code, "Variant state data is incomplete")
    packet = strict_keys(data.get("packet"),
                         {"version", "frameCount", "classes", "effects", "initial", "sequential",
                          "nonInteractiveJumps"}, code, "variant packet")
    require(set(packet) == {"version", "frameCount", "classes", "effects", "initial", "sequential",
                            "nonInteractiveJumps"}, code, "Variant packet is incomplete")
    frame_count = int(playback_binding["parameters"]["frameCount"])
    require(as_int(packet.get("version"), "FRAME_CARDINALITY_MISMATCH", "variant version") == 0
            and packet.get("frameCount") == frame_count,
            "FRAME_CARDINALITY_MISMATCH", "Variant version or frameCount is invalid")
    require(len(nodes) * frame_count <= limits["visibility_cells"],
            "VARIANT_STATE_LIMIT", "Prepared variant state matrix is excessive")
    classes = packet.get("classes")
    require(isinstance(classes, list) and 0 < len(classes) < 0xffff
            and len(classes) <= limits["prepared_states"],
            "VARIANT_STATE_LIMIT", "Prepared variant class table is invalid or excessive")
    for index, token in enumerate(classes):
        require(isinstance(token, str)
                and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,63}", token)
                and (index == 0 or classes[index - 1] < token), code,
                f"Prepared variant class {index} is invalid or noncanonical")

    effects = packet.get("effects")
    require(isinstance(effects, list) and 0 < len(effects) <= limits["prepared_changes"],
            "VARIANT_EFFECT_LIMIT", "Prepared variant effect table is missing or excessive")
    nodes_by_id = {node["id"]: node for node in tree_nodes}
    effect_classes, ownership, sinks, previous_effect = set(), {}, {"class.prepared"}, ""
    for index, effect in enumerate(effects):
        effect = strict_keys(effect, {"classIndex", "ownerIndex", "styles", "targetIndex"},
                             "INVALID_VARIANT_EFFECT", f"variant effect {index}")
        class_index = as_int(effect.get("classIndex"), "INVALID_VARIANT_EFFECT", f"variant effect {index} class")
        owner_index = as_int(effect.get("ownerIndex"), "INVALID_VARIANT_EFFECT", f"variant effect {index} owner")
        target_index = as_int(effect.get("targetIndex"), "INVALID_VARIANT_EFFECT", f"variant effect {index} target")
        require(class_index < len(classes) and owner_index < len(nodes)
                and (target_index == 0xffff or target_index < len(effect_nodes)),
                "INVALID_VARIANT_EFFECT", f"Variant effect {index} indices are invalid")
        effect_key = f"{class_index:05d}:{owner_index:05d}:{target_index:05d}"
        require(effect_key > previous_effect, "INVALID_VARIANT_EFFECT",
                "Variant effects are not unique and canonical")
        previous_effect = effect_key
        effect_classes.add(class_index)
        owner_id = nodes[owner_index]
        owner_node = nodes_by_id[owner_id]
        target_id = owner_id if target_index == 0xffff else effect_nodes[target_index]
        target_node = nodes_by_id[target_id]
        if target_index != 0xffff:
            parent, descendant = target_node["parent"], False
            while parent >= 0:
                if parent == owner_node["index"]:
                    descendant = True
                    break
                parent = tree_nodes[parent]["parent"]
            require(descendant, "INVALID_VARIANT_EFFECT",
                    f"Variant effect {index} target is not below its owner")
        styles = strict_keys(effect.get("styles"), set(VARIANT_EFFECT_PROPERTIES),
                             "INVALID_VARIANT_EFFECT", f"variant effect {index} styles")
        require(0 < len(styles) <= len(VARIANT_EFFECT_PROPERTIES), "INVALID_VARIANT_EFFECT",
                f"Variant effect {index} styles are empty or excessive")
        for property_name, value in styles.items():
            require(property_name in VARIANT_EFFECT_PROPERTIES and isinstance(value, str) and value,
                    "INVALID_VARIANT_EFFECT", f"Variant effect {index} style is invalid")
            safe_style(value, f"Variant effect {index} style {property_name}")
            if property_name == "display":
                require(value in ("block", "none"), "INVALID_VARIANT_EFFECT",
                        f"Variant effect {index} display is unsupported")
            if property_name == "backgroundPositionX":
                require(re.fullmatch(r"(?:0|-?[1-9][0-9]*px)", value) is not None,
                        "INVALID_VARIANT_EFFECT", f"Variant effect {index} position is noncanonical")
            conflicts = ("backgroundPosition", "backgroundPositionX") if property_name == "backgroundPositionX" else (property_name,)
            require(not any(name in target_node.get("styles", {}) for name in conflicts),
                    "VARIANT_TREE_MISMATCH", f"Variant effect {index} is shadowed by TREE inline state")
            sink = VARIANT_EFFECT_PROPERTIES[property_name]
            if (sink == "style.backgroundPositionX" and surface_binding is not None
                    and "style.backgroundPosition" in surface_binding["sinks"]):
                surface_targets: list[str] = []
                collect_targets(surface_binding["targets"], surface_targets, limits["nodes"] + 1,
                                "surface targets", limits["depth"])
                require(target_id not in surface_targets, "TARGET_OWNERSHIP_CONFLICT",
                        f"Variant effect {index} conflicts with full prepared surface ownership")
            sinks.add(sink)
            ownership_key = (target_id, sink)
            require(ownership_key not in ownership or ownership[ownership_key] == owner_index,
                    "TARGET_OWNERSHIP_CONFLICT", f"Variant effect {index} has multiple owners")
            ownership[ownership_key] = owner_index
    require(len(effect_classes) == len(classes), "INVALID_VARIANT_EFFECT",
            "Every prepared variant class must declare an effect")
    exact_array(binding.get("sinks"), sorted(sinks), "INVALID_VARIANT_BINDING",
                "Variant sinks are incomplete or noncanonical")

    initial = strict_keys(packet.get("initial"), {"frame", "classIndicesBase64"},
                          code, "variant initial state")
    require(set(initial) == {"frame", "classIndicesBase64"}, code,
            "Variant initial state is incomplete")
    require(initial.get("frame") == 1
            and initial.get("frame") == playback_packet["initial"]["sourceFrame"],
            "FRAME_CARDINALITY_MISMATCH",
            "Variant initial frame must be frame 1 and match playback")
    initial_indices = base64_integers(initial.get("classIndicesBase64"), 2, len(nodes),
                                      code, "variant initial classes")
    valid_class = lambda value: value == 0xffff or value < len(classes)
    require(len(initial_indices) == len(nodes) and all(map(valid_class, initial_indices)),
            code, "Variant initial classes are invalid")

    sequential = strict_keys(packet.get("sequential"),
                             {"offsetsBase64", "targetIndicesBase64", "classIndicesBase64"},
                             code, "variant sequential transitions")
    require(set(sequential) == {"offsetsBase64", "targetIndicesBase64", "classIndicesBase64"},
            code, "Variant sequential transitions are incomplete")
    offsets = base64_integers(sequential.get("offsetsBase64"), 4, frame_count + 1,
                              code, "variant transition offsets")
    target_indices = base64_integers(sequential.get("targetIndicesBase64"), 2,
                                     limits["prepared_changes"],
                                     "VARIANT_STATE_LIMIT", "variant transition targets")
    class_indices = base64_integers(sequential.get("classIndicesBase64"), 2,
                                    limits["prepared_changes"],
                                    "VARIANT_STATE_LIMIT", "variant transition classes")
    require(len(offsets) == frame_count + 1 and offsets[0] == 0
            and offsets[-1] == len(target_indices)
            and all(offsets[index - 1] <= value
                    for index, value in enumerate(offsets) if index > 0),
            "STATE_COLUMN_MISMATCH", "Variant transition offsets are invalid")
    require(len(target_indices) == len(class_indices), "STATE_COLUMN_MISMATCH",
            "Variant transition columns have unequal lengths")

    def apply_segment(row: list[int], segment: int, label: str) -> None:
        previous = -1
        for cursor in range(offsets[segment], offsets[segment + 1]):
            target, class_index = target_indices[cursor], class_indices[cursor]
            require(target < len(nodes) and target > previous and valid_class(class_index),
                    code, f"{label} is invalid")
            require(row[target] != class_index, code, f"{label} contains a no-op")
            row[target] = class_index
            previous = target

    jumps = packet.get("nonInteractiveJumps")
    require(isinstance(jumps, list) and len(jumps) <= frame_count, code,
            "Variant jumps are invalid or excessive")
    pairs, jump_endpoints, decoded_jumps = set(), set(), []
    for index, jump in enumerate(jumps):
        jump = strict_keys(jump,
                           {"fromFrame", "toFrame", "targetIndicesBase64", "classIndicesBase64"},
                           code, f"variant jump {index}")
        require(set(jump) == {"fromFrame", "toFrame", "targetIndicesBase64", "classIndicesBase64"},
                code, f"Variant jump {index} is incomplete")
        from_frame = as_int(jump.get("fromFrame"), code, f"variant jump {index} fromFrame", 1)
        to_frame = as_int(jump.get("toFrame"), code, f"variant jump {index} toFrame", 1)
        pair = f"{from_frame}>{to_frame}"
        require(from_frame <= frame_count and to_frame <= frame_count
                and from_frame != to_frame and pair not in pairs,
                code, f"Variant jump {index} frames are invalid or duplicated")
        pairs.add(pair)
        jump_targets = base64_integers(jump.get("targetIndicesBase64"), 2, len(nodes),
                                       code, f"variant jump {index} targets")
        jump_classes = base64_integers(jump.get("classIndicesBase64"), 2, len(nodes),
                                       code, f"variant jump {index} classes")
        require(len(jump_targets) == len(jump_classes)
                and all(target < len(nodes)
                        and (cursor == 0 or jump_targets[cursor - 1] < target)
                        and valid_class(jump_classes[cursor])
                        for cursor, target in enumerate(jump_targets)), code,
                f"Variant jump {index} rows are invalid")
        jump_endpoints.update((from_frame, to_frame))
        decoded_jumps.append((pair, from_frame, to_frame, jump_targets, jump_classes))

    endpoint_rows = {1: initial_indices} if 1 in jump_endpoints else {}
    current = list(initial_indices)
    for frame in range(2, frame_count + 1):
        apply_segment(current, frame - 1, f"Variant transition {frame - 1}>{frame}")
        if frame in jump_endpoints:
            endpoint_rows[frame] = list(current)
    apply_segment(current, 0, f"Variant transition {frame_count}>1")
    require(current == initial_indices, "VARIANT_TRANSITION_MISMATCH",
            "Variant wrap transition does not reproduce frame 1")

    for pair, from_frame, to_frame, jump_targets, jump_classes in decoded_jumps:
        expected_targets, expected_classes = [], []
        for target in range(len(nodes)):
            if endpoint_rows[from_frame][target] != endpoint_rows[to_frame][target]:
                expected_targets.append(target)
                expected_classes.append(endpoint_rows[to_frame][target])
        require(jump_targets == expected_targets and jump_classes == expected_classes,
                "VARIANT_JUMP_MISMATCH",
                f"Variant jump {pair} contradicts canonical target state")
    return packet


def desired_page_resources(packet: dict, frame: int, pinned_frames: list[int]) -> set[str]:
    current = next((index for index, page in enumerate(packet["pages"])
                    if page["startFrame"] <= frame <= page["endFrame"]), -1)
    require(current >= 0, "STATE_PAGE_COVERAGE_MISMATCH",
            f"Prepared frame {frame} has no state page descriptor")
    resources = {packet["pages"][current]["resource"]}
    for pinned_frame in pinned_frames:
        page = next((page for page in packet["pages"]
                     if page["startFrame"] <= pinned_frame <= page["endFrame"]), None)
        require(page is not None, "STATE_PAGE_COVERAGE_MISMATCH",
                f"Pinned prepared frame {pinned_frame} has no state page descriptor")
        resources.add(page["resource"])
    for offset in range(1, int(packet["lookaheadPages"]) + 1):
        resources.add(packet["pages"][(current + offset) % len(packet["pages"])]["resource"])
    return resources


def required_document_state_residency(packets: list[dict], pinned_frames: list[int],
                                      active_frame_pins: list[int] | None = None) -> int:
    required = 0
    candidate_frames = sorted({page["startFrame"] for packet in packets
                               for page in packet["pages"]})
    candidate_pins: list[int | None] = active_frame_pins or [None]
    for frame in candidate_frames:
        for active_frame_pin in candidate_pins:
            resources: set[str] = set()
            pins = pinned_frames if active_frame_pin is None \
                else [*pinned_frames, active_frame_pin]
            for packet in packets:
                resources.update(desired_page_resources(packet, frame, pins))
            published_transfer = sum(
                1 for packet in packets
                if any(page["resource"] not in resources for page in packet["pages"])
            )
            required = max(required, len(resources) + published_transfer)
    return required


def validate_paged_variants_contract(state_channel: dict, binding: dict,
                                     playback_packet: dict, playback_binding: dict,
                                     binding_inputs: dict[str, dict], limits: dict[str, int],
                                     tree_nodes: list[dict], surface_binding: dict | None) -> dict:
    data = strict_keys(state_channel.get("data"), {"packet"},
                       "INVALID_PAGED_VARIANT_STATE", "paged variant state")
    packet = strict_keys(data.get("packet"), {"version", "frameCount", "classes", "effects",
                         "initial", "pages", "lookaheadPages", "maxResidentPages"},
                         "INVALID_PAGED_VARIANT_STATE", "paged variant packet")
    require(set(data) == {"packet"} and set(packet) == {"version", "frameCount", "classes",
            "effects", "initial", "pages", "lookaheadPages", "maxResidentPages"},
            "INVALID_PAGED_VARIANT_STATE", "Paged variant packet is incomplete")
    frame_count = as_int(packet.get("frameCount"), "STATE_PAGE_COVERAGE_MISMATCH",
                         "paged variant frameCount", 1)
    require(as_int(packet.get("version"), "INVALID_PAGED_VARIANT_STATE",
                   "paged variant version") == 0
            and frame_count == playback_binding["parameters"]["frameCount"],
            "STATE_PAGE_COVERAGE_MISMATCH", "Paged variant frame count differs from playback")
    zero_offsets = base64.b64encode(bytes((frame_count + 1) * 4)).decode("ascii")
    validate_variants_contract(
        {**state_channel, "data": {"packet": {
            "version": 0, "frameCount": frame_count, "classes": packet.get("classes"),
            "effects": packet.get("effects"), "initial": packet.get("initial"),
            "sequential": {"offsetsBase64": zero_offsets, "targetIndicesBase64": "",
                           "classIndicesBase64": ""}, "nonInteractiveJumps": []}}},
        binding, playback_packet, playback_binding, binding_inputs, limits,
        tree_nodes, surface_binding)
    lookahead = as_int(packet.get("lookaheadPages"), "STATE_PAGE_RESIDENCY_LIMIT",
                       "paged variant lookahead", 1)
    resident = as_int(packet.get("maxResidentPages"), "STATE_PAGE_RESIDENCY_LIMIT",
                      "paged variant residency", 1)
    require(lookahead <= 4 and lookahead + 1 <= resident <= 16,
            "STATE_PAGE_RESIDENCY_LIMIT", "Paged variant residency is invalid")
    pages = packet.get("pages")
    require(isinstance(pages, list) and 0 < len(pages) <= limits["state_pages"],
            "STATE_PAGE_COVERAGE_MISMATCH", "Paged variant pages are missing or excessive")
    resources, expected = set(), 1
    for index, page in enumerate(pages):
        page = strict_keys(page, {"resource", "startFrame", "endFrame", "changeCount",
                          "materializedByteLength"},
                           "INVALID_PAGED_VARIANT_STATE", f"paged variant page {index}")
        require(set(page) == {"resource", "startFrame", "endFrame", "changeCount",
                "materializedByteLength"}, "INVALID_PAGED_VARIANT_STATE",
                f"Paged variant page {index} is incomplete")
        resource = resource_id(page.get("resource"), f"paged variant page {index} resource")
        start = as_int(page.get("startFrame"), "STATE_PAGE_COVERAGE_MISMATCH",
                       f"paged variant page {index} start", 1)
        end = as_int(page.get("endFrame"), "STATE_PAGE_COVERAGE_MISMATCH",
                     f"paged variant page {index} end", 1)
        require(resource not in resources and start == expected and start <= end <= frame_count,
                "STATE_PAGE_COVERAGE_MISMATCH", f"Paged variant page {index} is noncontiguous")
        require(end - start + 1 <= limits["state_page_frames"],
                "STATE_PAGE_COVERAGE_MISMATCH",
                f"Paged variant page {index} exceeds the per-page frame limit")
        changes = as_int(page.get("changeCount"), "STATE_CHANGE_LIMIT",
                         f"paged variant page {index} changes")
        materialized = as_int(page.get("materializedByteLength"), "STATE_PAGE_RESIDENCY_LIMIT",
                              f"paged variant page {index} materialized bytes", 1)
        require(changes <= limits["prepared_changes"] and materialized <= limits["decoded_total"],
                "STATE_PAGE_TABLE_LIMIT", f"Paged variant page {index} is excessive")
        resources.add(resource)
        expected = end + 1
    require(expected == frame_count + 1, "STATE_PAGE_COVERAGE_MISMATCH",
            "Paged variant pages do not cover playback exactly")
    return packet


def validate_compositor_timing_contract(state_channel: dict, binding: dict,
                                        playback_packet: dict, playback_binding: dict,
                                        binding_inputs: dict[str, dict],
                                        limits: dict[str, int]) -> None:
    for input_id in ("time.source-frame", "time.tick"):
        definition = binding_inputs.get(input_id, {})
        require(definition.get("type") == "uint" and "default" not in definition,
                "INVALID_COMPOSITOR_TIMING_BINDING",
                "Compositor timing inputs must be un-defaulted uints")
    targets = strict_keys(binding.get("targets"), {"nodes"},
                          "INVALID_COMPOSITOR_TIMING_BINDING", "compositor targets")
    nodes = unique_targets(targets.get("nodes"), min(limits["nodes"], 1024),
                           "INVALID_COMPOSITOR_TIMING_BINDING", "compositor node")
    parameters = strict_keys(binding.get("parameters"), {"frameCount", "tickRateHz", "tickIntervalUs"},
                             "INVALID_COMPOSITOR_TIMING_BINDING", "compositor parameters")
    validate_tick_cadence(parameters, "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor timing")
    require(parameters.get("frameCount") == playback_binding["parameters"]["frameCount"]
            and same_tick_cadence(parameters, playback_binding["parameters"]),
            "INVALID_COMPOSITOR_TIMING_BINDING", "Compositor cadence differs from playback")
    bank_timelines = [timeline for bank in playback_packet.get("banks", [])
                      for timeline in [bank["timeline"], *bank.get("profileTimelines", [])]]
    require(all("deadlineMicros" not in timeline for timeline in
                [playback_packet["timeline"], *playback_packet.get("profileTimelines", []),
                 *bank_timelines]),
            "INVALID_COMPOSITOR_TIMING_BINDING",
            "Compositor timing requires fixed playback cadence")
    data = strict_keys(state_channel.get("data"), {"packet"},
                       "INVALID_COMPOSITOR_TIMING_STATE", "compositor state")
    packet = strict_keys(data.get("packet"), {"version", "timing", "targets"},
                         "INVALID_COMPOSITOR_TIMING_STATE", "compositor packet")
    packet_targets = packet.get("targets")
    require(as_int(packet.get("version"), "INVALID_COMPOSITOR_TIMING_STATE",
                   "compositor version") == 0 and packet.get("timing") == "linear"
            and isinstance(packet_targets, list) and 0 < len(packet_targets) <= min(limits["nodes"], 1024)
            and len(packet_targets) == len(nodes), "INVALID_COMPOSITOR_TIMING_STATE",
            "Compositor timing packet is invalid")
    playback_targets, keyframe_count = playback_binding["targets"], 0
    transform_count = as_int(playback_packet["transforms"]["count"],
                             "INVALID_COMPOSITOR_TIMING_STATE", "playback transform count", 1)
    for target_index, target in enumerate(packet_targets):
        require(isinstance(target, dict), "INVALID_COMPOSITOR_TIMING_STATE",
                f"Compositor target {target_index} is invalid")
        owner, index = target.get("owner"), target.get("index")
        expected = playback_targets["model"] if owner == "model" and index == 0 else None
        if owner == "shape" and is_safe_int(index, 0, len(playback_targets["shapes"]) - 1):
            expected = playback_targets["shapes"][int(index)]
        if owner == "leaf" and is_safe_int(index, 0, len(playback_targets["leaves"]) - 1):
            expected = playback_targets["leaves"][int(index)]
        require(expected == nodes[target_index], "INVALID_COMPOSITOR_TIMING_BINDING",
                f"Compositor target {target_index} is not its playback owner")
        if target.get("kind") == "cycle":
            target = strict_keys(target, {"kind", "owner", "index", "durationTicks", "iterations",
                                         "closure", "keyframes"}, "INVALID_COMPOSITOR_TIMING_STATE",
                                 f"compositor cycle {target_index}")
            duration = as_int(target.get("durationTicks"), "INVALID_COMPOSITOR_TIMING_STATE",
                              "compositor duration", 2)
            keyframes = target.get("keyframes")
            require(owner == "model" and index == 0 and target.get("iterations") == "infinite"
                    and target.get("closure") == "closed" and duration <= limits["timeline_ticks"]
                    and isinstance(keyframes, list) and 3 <= len(keyframes) <= 256,
                    "INVALID_COMPOSITOR_TIMING_STATE", "Compositor cycle is invalid")
            previous = -1
            for keyframe_index, row in enumerate(keyframes):
                row = strict_keys(row, {"tick", "transformIndex"},
                                  "INVALID_COMPOSITOR_TIMING_STATE", "compositor keyframe")
                tick = as_int(row.get("tick"), "INVALID_COMPOSITOR_TIMING_STATE",
                              "compositor keyframe tick")
                transform = as_int(row.get("transformIndex"), "INVALID_COMPOSITOR_TIMING_STATE",
                                   "compositor keyframe transform")
                require(previous < tick <= duration and transform < transform_count,
                        "INVALID_COMPOSITOR_TIMING_STATE", "Compositor keyframe is invalid")
                previous = tick
            require(keyframes[0]["tick"] == 0 and keyframes[-1]["tick"] == duration
                    and keyframes[0]["transformIndex"] == keyframes[-1]["transformIndex"],
                    "INVALID_COMPOSITOR_TIMING_STATE", "Compositor cycle is not exactly closed")
            require(all(row[2] == -1 for row in playback_packet["frameRows"]),
                    "TARGET_OWNERSHIP_CONFLICT", "Compositor cycle races playback")
            keyframe_count += len(keyframes)
        else:
            target = strict_keys(target, {"kind", "owner", "index", "durationTicks"},
                                 "INVALID_COMPOSITOR_TIMING_STATE", "compositor transition")
            require(target.get("kind") == "transition"
                    and 1 <= as_int(target.get("durationTicks"), "INVALID_COMPOSITOR_TIMING_STATE",
                                   "compositor transition duration", 1) <= 8,
                    "INVALID_COMPOSITOR_TIMING_STATE", "Compositor transition is invalid")
    require(keyframe_count <= 4096, "COMPOSITOR_TIMING_LIMIT", "Compositor keyframes are excessive")


def validate_viewport_profiles_contract(state_channel: dict, binding: dict,
                                        playback_packet: dict, playback_binding: dict,
                                        presentation_packet: dict,
                                        binding_inputs: dict[str, dict],
                                        limits: dict[str, int]) -> None:
    leaf_count = int(playback_packet["leafCount"])
    for input_id in ("viewport.height", "viewport.width"):
        definition = binding_inputs.get(input_id, {})
        require(definition.get("type") == "float" and "default" not in definition,
                "INVALID_VIEWPORT_PROFILE_BINDING",
                "Viewport profile inputs must be un-defaulted floats")
    require("parameters" not in binding, "INVALID_VIEWPORT_PROFILE_BINDING",
            "Viewport profiles have no parameters")
    targets = strict_keys(binding.get("targets"), {"leaves"},
                          "INVALID_VIEWPORT_PROFILE_BINDING", "viewport profile targets")
    leaves = unique_targets(targets.get("leaves"), limits["nodes"],
                            "INVALID_VIEWPORT_PROFILE_BINDING", "viewport profile leaf")
    require(leaves == playback_binding["targets"]["leaves"], "TARGET_CARDINALITY_MISMATCH",
            "Viewport profile leaves differ from playback")
    data = strict_keys(state_channel.get("data"), {"packet"},
                       "INVALID_VIEWPORT_PROFILE_STATE", "viewport profile state")
    packet = strict_keys(data.get("packet"), {"version", "selection", "transforms", "profiles"},
                         "INVALID_VIEWPORT_PROFILE_STATE", "viewport profile packet")
    require(as_int(packet.get("version"), "INVALID_VIEWPORT_PROFILE_STATE",
                   "viewport profile version") == 0,
            "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile version must be zero")
    selection = strict_keys(packet.get("selection"), {"mode"},
                            "INVALID_VIEWPORT_PROFILE_STATE", "viewport profile selection")
    mode = selection.get("mode")
    require(mode in ("presentation-profile", "smallest-covering"),
            "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile selection is unsupported")
    transforms = packet.get("transforms")
    require(isinstance(transforms, list) and len(transforms) < 0xffff
            and len(transforms) <= limits["prepared_transforms"], "TRANSFORM_ALLOCATION_LIMIT",
            "Viewport transforms are excessive")
    previous = None
    for transform in transforms:
        require(isinstance(transform, list) and len(transform) == 12
                and all(not isinstance(value, bool) and isinstance(value, (int, float))
                        and math.isfinite(value) for value in transform),
                "INVALID_VIEWPORT_PROFILE_STATE", "Viewport transform is invalid")
        if previous is not None:
            require(tuple(transform) > tuple(previous), "INVALID_VIEWPORT_PROFILE_STATE",
                    "Viewport transforms are not lexicographically sorted")
        previous = transform
    profiles = packet.get("profiles")
    require(isinstance(profiles, list) and 0 < len(profiles) <= 256
            and len(profiles) * max(1, leaf_count) <= limits["visibility_cells"],
            "VIEWPORT_PROFILE_LIMIT", "Viewport profiles are missing or excessive")
    presentation_profiles = presentation_packet["camera"].get("profiles")
    if mode == "presentation-profile":
        require(isinstance(presentation_profiles, list)
                and len(profiles) == len(presentation_profiles),
                "INVALID_VIEWPORT_PROFILE_STATE",
                "Viewport profiles differ from presentation profiles")
    ids, referenced, previous_key = set(), set(), None
    visibility_change_count, responsive_coefficient_count = 0, 0
    for index, profile in enumerate(profiles):
        profile = strict_keys(profile, {"id", "width", "height", "transformIndicesBase64",
                                       "visibleBitsBase64", "visibilityChanges", "responsiveAffine"}, "INVALID_VIEWPORT_PROFILE_STATE",
                              f"viewport profile {index}")
        require({"id", "transformIndicesBase64", "visibleBitsBase64"}.issubset(profile),
                "INVALID_VIEWPORT_PROFILE_STATE", "Viewport profile is incomplete")
        profile_id = stable_id(profile.get("id"), f"viewport profile {index} id")
        require(profile_id not in ids, "INVALID_VIEWPORT_PROFILE_STATE",
                "Viewport profile ids are duplicated")
        ids.add(profile_id)
        if mode == "presentation-profile":
            require("width" not in profile and "height" not in profile
                    and profile_id == presentation_profiles[index]["id"],
                    "INVALID_VIEWPORT_PROFILE_STATE",
                    "Viewport profile differs from presentation order")
        else:
            width = as_int(profile.get("width"), "INVALID_VIEWPORT_PROFILE_STATE",
                           "viewport profile width", 1)
            height = as_int(profile.get("height"), "INVALID_VIEWPORT_PROFILE_STATE",
                            "viewport profile height", 1)
            require(width <= 1_000_000 and height <= 1_000_000,
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport dimensions are excessive")
            key = (width * height, width + height, width, height)
            require(previous_key is None or key > previous_key,
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport covering profiles are unsorted")
            previous_key = key
        transform_indices = base64_integers(profile.get("transformIndicesBase64"), 2,
                                            leaf_count,
                                            "INVALID_VIEWPORT_PROFILE_STATE", "viewport transforms")
        require(len(transform_indices) == leaf_count
                and all(value == 0xffff or value < len(transforms) for value in transform_indices),
                "STATE_COLUMN_MISMATCH", "Viewport transform row is invalid")
        referenced.update(value for value in transform_indices if value != 0xffff)
        bits = base64_integers(profile.get("visibleBitsBase64"), 1,
                               math.ceil(leaf_count / 8),
                               "INVALID_VIEWPORT_PROFILE_STATE", "viewport visibility")
        require(len(bits) == math.ceil(leaf_count / 8)
                and (leaf_count % 8 == 0 or not bits
                     or bits[-1] >> (leaf_count % 8) == 0),
                "STATE_COLUMN_MISMATCH", "Viewport visibility row is invalid")
        if "visibilityChanges" in profile:
            changes = strict_keys(profile["visibilityChanges"],
                                  {"offsetsBase64", "leafIndicesBase64"},
                                  "INVALID_VIEWPORT_PROFILE_STATE", "viewport visibility changes")
            require({"offsetsBase64", "leafIndicesBase64"}.issubset(changes),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport visibility changes are incomplete")
            frame_count = as_int(playback_binding["parameters"].get("frameCount"),
                                 "INVALID_VIEWPORT_PROFILE_STATE", "viewport frame count", 1)
            offsets = base64_integers(changes["offsetsBase64"], 4, frame_count + 1,
                                      "INVALID_VIEWPORT_PROFILE_STATE", "viewport visibility offsets")
            change_leaves = base64_integers(changes["leafIndicesBase64"], 2,
                                            limits["prepared_changes"],
                                            "INVALID_VIEWPORT_PROFILE_STATE", "viewport visibility leaves")
            require(len(offsets) == frame_count + 1 and offsets[0] == 0
                    and offsets[-1] == len(change_leaves)
                    and all(offsets[cursor] >= offsets[cursor - 1]
                            for cursor in range(1, len(offsets))),
                    "STATE_COLUMN_MISMATCH", "Viewport visibility offsets are invalid")
            for frame in range(frame_count):
                row = change_leaves[offsets[frame]:offsets[frame + 1]]
                require(all(0 <= leaf < leaf_count for leaf in row)
                        and all(row[cursor] > row[cursor - 1]
                                for cursor in range(1, len(row))),
                        "INVALID_VIEWPORT_PROFILE_STATE",
                        "Viewport visibility row is unsorted or out of range")
            visibility_change_count += len(change_leaves)
            require(visibility_change_count <= limits["prepared_changes"],
                    "VIEWPORT_PROFILE_LIMIT", "Viewport visibility changes are excessive")
            reconstructed = [(bits[leaf >> 3] >> (leaf & 7)) & 1
                             for leaf in range(leaf_count)]
            for frame in range(1, frame_count):
                for cursor in range(offsets[frame], offsets[frame + 1]):
                    reconstructed[change_leaves[cursor]] ^= 1
            for cursor in range(offsets[0], offsets[1]):
                reconstructed[change_leaves[cursor]] ^= 1
            require(all(value == ((bits[leaf >> 3] >> (leaf & 7)) & 1)
                        for leaf, value in enumerate(reconstructed)),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport visibility cycle does not close")
        if "responsiveAffine" in profile:
            affine = strict_keys(profile["responsiveAffine"],
                                 {"scale", "presentBitsBase64", "coefficientsBase64"},
                                 "INVALID_VIEWPORT_PROFILE_STATE", "viewport responsive affine")
            require({"scale", "presentBitsBase64", "coefficientsBase64"}.issubset(affine),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport responsive affine is incomplete")
            scale = strict_keys(affine["scale"], {"baseWidth", "baseHeight", "multiplier", "max"},
                                "INVALID_VIEWPORT_PROFILE_STATE", "viewport responsive affine scale")
            require({"baseWidth", "baseHeight", "multiplier"}.issubset(scale),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport responsive affine scale is incomplete")
            require(all(not isinstance(scale[key], bool) and isinstance(scale[key], (int, float))
                        and math.isfinite(scale[key]) and 0 < scale[key] <= 1_000_000
                        for key in ("baseWidth", "baseHeight", "multiplier"))
                    and ("max" not in scale or (not isinstance(scale["max"], bool)
                         and isinstance(scale["max"], (int, float)) and math.isfinite(scale["max"])
                         and 0 < scale["max"] <= 1_000_000)),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport responsive affine scale is invalid")
            present = base64_integers(affine["presentBitsBase64"], 1,
                                      math.ceil(leaf_count / 8),
                                      "INVALID_VIEWPORT_PROFILE_STATE", "viewport responsive presence")
            require(len(present) == math.ceil(leaf_count / 8)
                    and (leaf_count % 8 == 0 or not present
                         or present[-1] >> (leaf_count % 8) == 0),
                    "STATE_COLUMN_MISMATCH", "Viewport responsive presence is invalid")
            present_count = sum((present[leaf >> 3] >> (leaf & 7)) & 1
                                for leaf in range(leaf_count))
            require(present_count > 0, "INVALID_VIEWPORT_PROFILE_STATE",
                    "Viewport responsive affine has no targets")
            coefficient_count = present_count * 16
            responsive_coefficient_count += coefficient_count
            require(responsive_coefficient_count <= limits["prepared_states"],
                    "VIEWPORT_PROFILE_LIMIT", "Viewport responsive coefficients are excessive")
            coefficients = base64_float64(affine["coefficientsBase64"], coefficient_count,
                                          "INVALID_VIEWPORT_PROFILE_STATE", "viewport responsive coefficients")
            require(len(coefficients) == coefficient_count
                    and all(math.isfinite(value)
                            and not (value == 0 and math.copysign(1, value) < 0)
                            for value in coefficients)
                    and all(abs(value) <= 1_000_000_000 for value in coefficients),
                    "INVALID_VIEWPORT_PROFILE_STATE", "Viewport responsive coefficients are invalid")
    require(len(referenced) == len(transforms), "INVALID_VIEWPORT_PROFILE_STATE",
            "Viewport transform dictionary contains an unreferenced row")


def validate_orbit_contract(state_channel: dict, binding: dict,
                            presentation_packet: dict | None,
                            binding_inputs: dict[str, dict], tree_nodes: list[dict],
                            limits: dict[str, int]) -> None:
    require(presentation_packet is not None, "MISSING_POLYCSS_CHANNEL",
            "Prepared orbit requires presentation")
    require("parameters" not in binding, "INVALID_ORBIT_BINDING",
            "Prepared orbit has no parameters")
    targets = strict_keys(binding.get("targets"), {"model", "leaves"},
                          "INVALID_ORBIT_BINDING", "orbit targets")
    model_target = stable_id(targets.get("model"), "orbit model target")
    leaves = unique_targets(targets.get("leaves"), min(limits["nodes"], 0xfffe),
                            "INVALID_ORBIT_BINDING", "orbit leaf")
    require(leaves and model_target not in leaves, "TARGET_CARDINALITY_MISMATCH",
            "Prepared orbit targets are invalid")
    data = strict_keys(state_channel.get("data"), {"packet"},
                       "INVALID_ORBIT_STATE", "orbit state")
    packet = strict_keys(data.get("packet"), {"version", "initial", "ranges", "model", "surface"},
                         "INVALID_ORBIT_STATE", "orbit packet")
    require(as_int(packet.get("version"), "INVALID_ORBIT_STATE", "orbit version") == 0,
            "INVALID_ORBIT_STATE", "Prepared orbit version must be zero")
    initial = strict_keys(packet.get("initial"), {"pitch", "yaw", "zoom"},
                          "INVALID_ORBIT_STATE", "orbit initial inputs")
    ranges = strict_keys(packet.get("ranges"), {"pitch", "yaw", "zoom"},
                         "INVALID_ORBIT_STATE", "orbit ranges")
    for name in ("pitch", "yaw", "zoom"):
        domain, value = ranges.get(name), initial.get(name)
        require(isinstance(domain, list) and len(domain) == 2
                and all(not isinstance(item, bool) and isinstance(item, (int, float))
                        and math.isfinite(item) for item in domain)
                and domain[0] < domain[1]
                and not isinstance(value, bool) and isinstance(value, (int, float))
                and math.isfinite(value) and domain[0] <= value <= domain[1]
                and binding_inputs.get(f"orbit.{name}", {}).get("type") == "float"
                and binding_inputs[f"orbit.{name}"].get("default") == value,
                "INVALID_ORBIT_STATE", f"Prepared orbit {name} contract is invalid")
    require(ranges["pitch"][0] >= -90 and ranges["pitch"][1] <= 90
            and ranges["yaw"][0] >= -360 and ranges["yaw"][1] <= 360
            and ranges["zoom"][0] > 0 and ranges["zoom"][1] <= 16,
            "INVALID_ORBIT_STATE", "Prepared orbit ranges exceed the interpreter domain")
    model = strict_keys(packet.get("model"), {"translation", "scale"},
                        "INVALID_ORBIT_STATE", "orbit model")
    require(isinstance(model.get("translation"), list) and len(model["translation"]) == 3
            and all(not isinstance(value, bool) and isinstance(value, (int, float))
                    and math.isfinite(value) and abs(value) <= 1_000_000 for value in model["translation"])
            and isinstance(model.get("scale"), list) and len(model["scale"]) == 3
            and all(not isinstance(value, bool) and isinstance(value, (int, float))
                    and math.isfinite(value) and 0 < value <= 16 for value in model["scale"]),
            "INVALID_ORBIT_STATE", "Prepared orbit model is invalid")
    by_id = {node["id"]: node for node in tree_nodes}
    translation = ", ".join(f"{css_number(value)}px" for value in model["translation"])
    scale = ", ".join(css_number(value * initial["zoom"]) for value in model["scale"])
    transform = (f"translate3d({translation}) rotateX({css_number(initial['pitch'])}deg) "
                 f"rotateY({css_number(initial['yaw'])}deg) scale3d({scale})")
    require(by_id[model_target].get("styles", {}).get("transform") == transform,
            "ORBIT_TREE_MISMATCH", "Prepared orbit model differs from TREE")
    surface = strict_keys(packet.get("surface"), {"stateCount", "positionDictionary",
                          "initialPositionIndicesBase64", "transitions"},
                          "INVALID_ORBIT_STATE", "orbit surface")
    state_count = as_int(surface.get("stateCount"), "ORBIT_STATE_LIMIT", "orbit stateCount", 2)
    require(state_count <= 360
            and round(((initial["yaw"] % 360) + 360) % 360 * state_count / 360) % state_count == 0,
            "ORBIT_STATE_LIMIT", "Prepared orbit state count or initial yaw is invalid")
    positions = surface.get("positionDictionary")
    require(isinstance(positions, list) and 0 < len(positions) < 0xffff
            and len(positions) <= limits["prepared_states"], "ORBIT_STATE_LIMIT",
            "Prepared orbit positions are invalid or excessive")
    previous = None
    for position in positions:
        require(isinstance(position, list) and len(position) == 2
                and all(is_safe_int(value, -0x7fffffff, 0x7fffffff)
                        and not (isinstance(value, float) and value == 0 and math.copysign(1, value) < 0)
                        for value in position), "INVALID_ORBIT_STATE", "Prepared orbit position is invalid")
        require(previous is None or tuple(position) > tuple(previous), "INVALID_ORBIT_STATE",
                "Prepared orbit positions are not sorted")
        previous = position
    current = base64_integers(surface.get("initialPositionIndicesBase64"), 2, len(leaves),
                              "INVALID_ORBIT_STATE", "orbit initial positions")
    require(len(current) == len(leaves) and all(value < len(positions) for value in current),
            "STATE_COLUMN_MISMATCH", "Prepared orbit initial positions are invalid")
    position_text = lambda position: " ".join("0" if value == 0 else f"{value}px" for value in position)
    for index, leaf in enumerate(leaves):
        require(by_id[leaf].get("styles", {}).get("backgroundPosition")
                == position_text(positions[current[index]]), "ORBIT_TREE_MISMATCH",
                f"Prepared orbit leaf {index} differs from TREE")
    transitions = strict_keys(surface.get("transitions"), {"offsetsBase64", "leafIndicesBase64",
                              "forwardPositionIndicesBase64", "backwardPositionIndicesBase64"},
                              "INVALID_ORBIT_STATE", "orbit transitions")
    offsets = base64_integers(transitions.get("offsetsBase64"), 4, state_count + 1,
                              "INVALID_ORBIT_STATE", "orbit offsets")
    require(len(offsets) == state_count + 1 and offsets[0] == 0
            and all(offsets[index - 1] <= value for index, value in enumerate(offsets) if index)
            and offsets[-1] <= limits["prepared_changes"], "INVALID_ORBIT_STATE",
            "Prepared orbit offsets are invalid")
    change_count = offsets[-1]
    transition_leaves = base64_integers(transitions.get("leafIndicesBase64"), 2, change_count,
                                        "INVALID_ORBIT_STATE", "orbit transition leaves")
    forward = base64_integers(transitions.get("forwardPositionIndicesBase64"), 2, change_count,
                              "INVALID_ORBIT_STATE", "orbit forward positions")
    backward = base64_integers(transitions.get("backwardPositionIndicesBase64"), 2, change_count,
                               "INVALID_ORBIT_STATE", "orbit backward positions")
    require(len(transition_leaves) == len(forward) == len(backward) == change_count,
            "STATE_COLUMN_MISMATCH", "Prepared orbit transition columns differ")
    require(state_count * len(leaves) <= limits["visibility_cells"],
            "ORBIT_STATE_LIMIT", "Prepared orbit canonical rows exceed their allocation limit")
    referenced = set(current)

    def apply_edge(row: list[int], edge: int, values: list[int]) -> None:
        previous_leaf = -1
        for cursor in range(offsets[edge], offsets[edge + 1]):
            leaf = transition_leaves[cursor]
            require(previous_leaf < leaf < len(leaves)
                    and forward[cursor] < len(positions) and backward[cursor] < len(positions)
                    and row[leaf] != values[cursor], "INVALID_ORBIT_STATE",
                    f"Prepared orbit edge {edge} is invalid")
            row[leaf] = values[cursor]
            previous_leaf = leaf
            referenced.update((forward[cursor], backward[cursor]))

    row = list(current)
    for state_index in range(1, state_count):
        previous = list(row)
        apply_edge(row, state_index, forward)
        reverse = list(row)
        apply_edge(reverse, state_index, backward)
        require(reverse == previous, "ORBIT_TRANSITION_MISMATCH",
                f"Prepared orbit backward edge {state_index} is invalid")
    final_row = list(row)
    apply_edge(row, 0, forward)
    require(row == current, "ORBIT_TRANSITION_MISMATCH",
            "Prepared orbit forward cycle does not close")
    reverse = list(row)
    apply_edge(reverse, 0, backward)
    require(reverse == final_row, "ORBIT_TRANSITION_MISMATCH",
            "Prepared orbit backward edge 0 is invalid")
    require(len(referenced) == len(positions), "INVALID_ORBIT_STATE",
            "Prepared orbit position dictionary contains an unreferenced row")


def validate_effects_contract(state_channel: dict, binding: dict,
                              binding_inputs: dict[str, dict],
                              playback_binding: dict | None,
                              limits: dict[str, int]) -> dict:
    code = "INVALID_EFFECTS_STATE"
    require(playback_binding is not None, "MISSING_POLYCSS_CHANNEL",
            "Prepared effects require executable playback")
    expected_inputs = ["interaction.grab-active", "interaction.grab-x",
                       "interaction.grab-y", "interaction.grab-z", "time.source-frame"]
    exact_array(binding.get("inputs"), expected_inputs, "INVALID_EFFECTS_BINDING",
                "Effect inputs are incomplete or noncanonical")
    for input_id, input_type, default in (
        ("interaction.grab-active", "boolean", False),
        ("interaction.grab-x", "float", 0),
        ("interaction.grab-y", "float", 0),
        ("interaction.grab-z", "float", 0),
    ):
        definition = binding_inputs.get(input_id, {})
        require(definition.get("type") == input_type and definition.get("default") == default,
                "INVALID_EFFECTS_BINDING",
                f"Effect input {input_id} has the wrong type or default")
    source_frame_input = binding_inputs.get("time.source-frame", {})
    require(source_frame_input.get("type") == "uint" and "default" not in source_frame_input,
            "INVALID_EFFECTS_BINDING",
            "Effect time.source-frame input must be uint without a package default")
    exact_array(binding.get("sinks"), ["style.backgroundPosition", "style.opacity",
                                      "style.transform", "style.visibility"],
                "INVALID_EFFECTS_BINDING", "Effect sinks are incomplete or noncanonical")
    parameters = strict_keys(binding.get("parameters"), {"frameCount"},
                             "INVALID_EFFECTS_BINDING", "effect parameters")
    require(set(parameters) == {"frameCount"}, "INVALID_EFFECTS_BINDING",
            "Effect parameters are incomplete")
    targets = strict_keys(binding.get("targets"), {"stars", "emitters"},
                          "INVALID_EFFECTS_BINDING", "effect targets")
    require(set(targets) == {"stars", "emitters"}, "INVALID_EFFECTS_BINDING",
            "Effect targets are incomplete")
    star_targets = unique_targets(targets.get("stars"), limits["nodes"],
                                  "INVALID_EFFECTS_BINDING", "effect star")
    emitter_targets = targets.get("emitters")
    require(isinstance(emitter_targets, list) and len(emitter_targets) <= limits["nodes"],
            "INVALID_EFFECTS_BINDING", "Effect emitter targets are invalid or excessive")

    data = strict_keys(state_channel.get("data"), {"packet"}, code,
                       "prepared effects state data")
    require(set(data) == {"packet"}, code, "Prepared effects state is incomplete")
    packet = strict_keys(data.get("packet"), {"version", "arithmetic", "frameCount",
                         "biases", "particle", "spawnStream", "stars", "emitters"},
                         code, "prepared effects packet")
    require(set(packet) == {"version", "arithmetic", "frameCount", "biases", "particle",
                            "spawnStream", "stars", "emitters"}, code,
            "Prepared effects packet is incomplete")
    require(as_int(packet.get("version"), code, "effects version") == 0
            and packet.get("arithmetic") == "ieee754-f32-per-operation", code,
            "Prepared effects version or arithmetic is unsupported")
    frame_count = as_int(packet.get("frameCount"), "EFFECT_STATE_LIMIT",
                         "effect frameCount", 1)
    require(frame_count <= limits["frames"], "EFFECT_STATE_LIMIT",
            "Effect frameCount is excessive")
    require(parameters.get("frameCount") == frame_count,
            "FRAME_CARDINALITY_MISMATCH", "Effect binding frameCount differs from packet")
    require(playback_binding["parameters"]["frameCount"] == frame_count,
            "FRAME_CARDINALITY_MISMATCH",
            "Effect and playback frame counts differ")

    biases = strict_keys(packet.get("biases"), {"continuous", "grab"}, code,
                         "effect biases")
    require(set(biases) == {"continuous", "grab"}, code, "Effect biases are incomplete")
    continuous_bias = finite_f32_array(biases.get("continuous"), 3, code,
                                       "continuous effect bias")
    grab_bias = finite_f32_array(biases.get("grab"), 3, code, "grab effect bias")
    particle = strict_keys(packet.get("particle"), {"damping", "gravityY", "sparkleFrameTable"},
                           code, "particle contract")
    require(set(particle) == {"damping", "gravityY", "sparkleFrameTable"}, code,
            "Particle contract is incomplete")
    require(finite_f32(particle.get("damping")) and 0 <= particle["damping"] <= 1
            and finite_f32(particle.get("gravityY")), code,
            "Particle damping or gravity is invalid")
    sparkle_frames = integer_array(particle.get("sparkleFrameTable"), 256, code,
                                   "particle sparkle frames", 0)
    require(bool(sparkle_frames), code, "Particle sparkle frame table is empty")
    spawn = strict_keys(packet.get("spawnStream"), {"count", "tuples"}, code,
                        "effect spawn stream")
    require(set(spawn) == {"count", "tuples"}, code, "Effect spawn stream is incomplete")
    spawn_count = as_int(spawn.get("count"), "EFFECT_STATE_LIMIT", "effect spawn count", 1)
    tuples = spawn.get("tuples")
    require(spawn_count <= limits["effect_spawn_tuples"] and isinstance(tuples, list)
            and len(tuples) == spawn_count, "EFFECT_STATE_LIMIT",
            "Effect spawn stream is invalid or excessive")
    for index, tuple_value in enumerate(tuples):
        values = finite_f32_array(tuple_value, 4, code, f"effect spawn tuple {index}")
        require(values[0] > 0 and math.trunc(values[0]) <= len(sparkle_frames), code,
                f"Effect spawn tuple {index} lifetime is invalid")
        for bias in (continuous_bias, grab_bias):
            require(all(finite_f32(values[component + 1] + bias[component])
                        for component in range(3)), code,
                    f"Effect spawn tuple {index} overflows with a declared bias")

    stars = packet.get("stars")
    emitters = packet.get("emitters")
    require(isinstance(stars, list) and len(stars) <= limits["nodes"],
            "EFFECT_STATE_LIMIT", "Effect stars are invalid or excessive")
    require(isinstance(emitters, list) and 0 < len(emitters) <= limits["nodes"],
            "EFFECT_STATE_LIMIT", "Effect emitters are invalid or excessive")
    require(len(stars) == len(star_targets) and len(emitters) == len(emitter_targets),
            "TARGET_CARDINALITY_MISMATCH", "Effect targets do not match state")
    total_particles = 0
    for index, emitter in enumerate(emitters):
        emitter = strict_keys(emitter,
                              {"mode", "sourceStar", "poolSize", "backgroundPositions"},
                              code, f"effect emitter {index}")
        mode = emitter.get("mode")
        require(mode in ("grab", "follow-star"), code,
                f"Effect emitter {index} mode is unsupported")
        if mode == "grab":
            require("sourceStar" not in emitter, code,
                    f"Grab emitter {index} must not declare sourceStar")
        else:
            require(is_safe_int(emitter.get("sourceStar"), 0, len(stars) - 1), code,
                    f"Effect emitter {index} sourceStar is invalid")
        pool_size = as_int(emitter.get("poolSize"), code,
                           f"effect emitter {index} poolSize", 1)
        total_particles += pool_size
        require(total_particles <= limits["effect_particles"], "EFFECT_PARTICLE_LIMIT",
                "Prepared effects have too many particles")
        positions = emitter.get("backgroundPositions")
        require(isinstance(positions, list) and 0 < len(positions) <= 256, code,
                f"Effect emitter {index} background positions are missing or excessive")
        for position in positions:
            safe_style(position, f"Effect emitter {index} background position")
        require(all(frame < len(positions) for frame in sparkle_frames), code,
                f"Effect emitter {index} lacks a referenced sparkle frame")
        pool_targets = unique_targets(emitter_targets[index], limits["effect_particles"],
                                      "INVALID_EFFECTS_BINDING",
                                      f"effect emitter {index} particle")
        require(len(pool_targets) == pool_size, "TARGET_CARDINALITY_MISMATCH",
                f"Effect emitter {index} targets do not match poolSize")

    for index, star in enumerate(stars):
        star = strict_keys(star, {"positions", "transforms", "frameIndices",
                                  "backgroundPositions"}, code, f"effect star {index}")
        require(set(star) == {"positions", "transforms", "frameIndices",
                              "backgroundPositions"}, code,
                f"Effect star {index} is incomplete")
        finite_f32_array(star.get("positions"), frame_count * 3, code,
                         f"effect star {index} positions")
        transforms = star.get("transforms")
        require(isinstance(transforms, list) and len(transforms) == frame_count,
                "FRAME_CARDINALITY_MISMATCH",
                f"Effect star {index} transforms do not match frameCount")
        for transform in transforms:
            safe_style(transform, f"Effect star {index} transform")
        positions = star.get("backgroundPositions")
        require(isinstance(positions, list) and 0 < len(positions) <= limits["frames"], code,
                f"Effect star {index} background positions are missing or excessive")
        for position in positions:
            safe_style(position, f"Effect star {index} background position")
        frames = integer_array(star.get("frameIndices"), frame_count,
                               "FRAME_CARDINALITY_MISMATCH",
                               f"effect star {index} frame indices", 0, len(positions) - 1)
        require(len(frames) == frame_count, "FRAME_CARDINALITY_MISMATCH",
                f"Effect star {index} frame indices do not match frameCount")

    maximum_movement_steps = max(math.ceil(tuple_value[0]) + 1 for tuple_value in tuples)
    continuous_velocity = [max(abs(f32(tuple_value[component + 1]
                                             + continuous_bias[component]))
                               for tuple_value in tuples)
                           for component in range(3)]
    continuous_start = [0.0, 0.0, 0.0]
    for star in stars:
        for index, value in enumerate(star["positions"]):
            component = index % 3
            continuous_start[component] = max(continuous_start[component], abs(value))
    for component in range(3):
        gravity = (abs(particle["gravityY"]) * maximum_movement_steps
                   * (maximum_movement_steps - 1) / 2 if component == 1 else 0)
        bound = (continuous_start[component]
                 + continuous_velocity[component] * maximum_movement_steps + gravity)
        require(finite_f32(bound), code,
                f"Prepared continuous effect component {component} can overflow")
    return packet


def validate_presentation_contract(state_channel: dict, binding: dict,
                                   binding_inputs: dict[str, dict]) -> dict:
    exact_array(binding.get("inputs"), ["viewport.height", "viewport.width"],
                "INVALID_PRESENTATION_BINDING",
                "Presentation inputs are incomplete or noncanonical")
    viewport_height = binding_inputs.get("viewport.height", {})
    viewport_width = binding_inputs.get("viewport.width", {})
    require(viewport_height.get("type") == "float"
            and viewport_width.get("type") == "float"
            and "default" not in viewport_height and "default" not in viewport_width,
            "INVALID_PRESENTATION_BINDING",
            "Presentation inputs must be float without package defaults")
    targets = strict_keys(binding.get("targets"),
                          {"camera", "cursorLayer", "cursorStates", "host"},
                          "INVALID_PRESENTATION_BINDING", "presentation targets")
    require({"camera", "host"}.issubset(targets)
            and targets.get("host") == "$host", "INVALID_PRESENTATION_BINDING",
            "Presentation targets are incomplete or invalid")
    stable_id(targets.get("camera"), "presentation camera target")
    has_cursor_layer = "cursorLayer" in targets
    has_cursor_states = "cursorStates" in targets
    require(has_cursor_layer == has_cursor_states, "INVALID_PRESENTATION_BINDING",
            "Presentation cursor layer and states must appear together")
    if has_cursor_layer:
        stable_id(targets.get("cursorLayer"), "presentation cursor layer target")
        cursor_states = strict_keys(targets.get("cursorStates"), {"open", "closed"},
                                    "INVALID_PRESENTATION_BINDING",
                                    "presentation cursor states")
        require(set(cursor_states) == {"open", "closed"}, "INVALID_PRESENTATION_BINDING",
                "Presentation cursor states are incomplete")
        opened = stable_id(cursor_states.get("open"), "presentation open cursor target")
        closed = stable_id(cursor_states.get("closed"), "presentation closed cursor target")
        require(opened != closed, "INVALID_PRESENTATION_BINDING",
                "Presentation cursor states must be distinct")
    parameters = strict_keys(binding.get("parameters"),
                             {"fitHeight", "fitWidth", "sourceHeight", "sourceWidth",
                              "profileSelection", "profiles"},
                             "INVALID_PRESENTATION_BINDING", "presentation parameters")
    require({"fitHeight", "fitWidth", "sourceHeight", "sourceWidth"}.issubset(parameters)
            and all(is_safe_int(parameters[key], 1)
                    for key in ("fitHeight", "fitWidth", "sourceHeight", "sourceWidth")),
            "INVALID_PRESENTATION_BINDING", "Presentation dimensions are invalid")

    missing_profile_field = object()

    def profiles(value: Any, selection: Any, code: str, label: str) -> list[dict] | None:
        if value is missing_profile_field:
            require(selection is missing_profile_field, code, f"{label} selection requires profiles")
            return None
        require(selection in ("viewport-width", "landscape-first-portrait-width"), code,
                f"{label} selection is unsupported")
        require(isinstance(value, list) and 0 < len(value) <= 16, code,
                f"{label} are missing or excessive")
        require(selection != "landscape-first-portrait-width" or len(value) >= 2, code,
                f"{label} landscape-first selection requires a landscape row and at least one portrait row")
        ids, maximum = set(), 0
        for index, profile in enumerate(value):
            profile = strict_keys(profile, {"id", "maxViewportWidth", "fit", "quarterTurns",
                                            "bounds", "safeInset", "bias"}, code,
                                  f"{label} {index}")
            require({"id", "fit", "quarterTurns", "bounds", "safeInset", "bias"}.issubset(profile),
                    code, f"{label} {index} is incomplete")
            profile_id = stable_id(profile.get("id"), f"{label} {index} id")
            require(profile_id not in ids, code, f"{label} ids are duplicated")
            ids.add(profile_id)
            landscape = selection == "landscape-first-portrait-width" and index == 0
            if landscape or index == len(value) - 1:
                require("maxViewportWidth" not in profile, code,
                        f"{label} {'landscape' if landscape else 'final'} profile must be unbounded")
            else:
                width = as_int(profile.get("maxViewportWidth"), code,
                               f"{label} breakpoint", 1)
                require(maximum < width <= 1_000_000, code,
                        f"{label} breakpoints are noncanonical")
                maximum = width
            require(profile.get("fit") in ("contain", "cover")
                    and is_safe_int(profile.get("quarterTurns"), 0, 3), code,
                    f"{label} fit or rotation is invalid")
            bounds = profile.get("bounds")
            require(isinstance(bounds, list) and len(bounds) == 4
                    and all(not isinstance(item, bool) and isinstance(item, (int, float))
                            and math.isfinite(item) and abs(item) <= 1_000_000 for item in bounds)
                    and bounds[2] > bounds[0] and bounds[3] > bounds[1], code,
                    f"{label} bounds are invalid")
            inset, bias = profile.get("safeInset"), profile.get("bias")
            require(not isinstance(inset, bool) and isinstance(inset, (int, float))
                    and math.isfinite(inset) and 0 <= inset <= 1_000_000
                    and isinstance(bias, list) and len(bias) == 2
                    and all(not isinstance(item, bool) and isinstance(item, (int, float))
                            and math.isfinite(item) and -1 <= item <= 1 for item in bias), code,
                    f"{label} inset or bias is invalid")
        return value

    parameter_selection = parameters.get("profileSelection", missing_profile_field)
    parameter_profiles = profiles(parameters.get("profiles", missing_profile_field), parameter_selection,
                                  "INVALID_PRESENTATION_BINDING",
                                  "Presentation binding profiles")

    data = strict_keys(state_channel.get("data"), {"packet"},
                       "INVALID_PRESENTATION_STATE", "presentation state data")
    packet = strict_keys(data.get("packet"), {"version", "camera", "background"},
                         "INVALID_PRESENTATION_STATE", "presentation packet")
    require(set(data) == {"packet"} and {"version", "camera"}.issubset(packet)
            and as_int(packet.get("version"), "INVALID_PRESENTATION_STATE", "presentation version") == 0,
            "INVALID_PRESENTATION_STATE",
            "Presentation state is incomplete or unsupported")
    camera = strict_keys(packet.get("camera"), {"baseSceneTransform", "fitHeight",
                         "fitWidth", "perspective", "sourceHeight", "sourceWidth",
                         "profileSelection", "profiles"},
                         "INVALID_PRESENTATION_STATE", "presentation camera")
    require({"baseSceneTransform", "fitHeight", "fitWidth", "perspective",
             "sourceHeight", "sourceWidth"}.issubset(camera), "INVALID_PRESENTATION_STATE",
            "Presentation camera is incomplete")
    safe_style(camera.get("baseSceneTransform"), "Presentation base scene transform")
    require(not isinstance(camera.get("perspective"), bool)
            and isinstance(camera.get("perspective"), (int, float))
            and math.isfinite(camera["perspective"]) and camera["perspective"] > 0
            and all(camera[key] == parameters[key]
                    for key in ("fitHeight", "fitWidth", "sourceHeight", "sourceWidth")),
            "INVALID_PRESENTATION_STATE",
            "Presentation camera values do not match parameters")
    camera_selection = camera.get("profileSelection", missing_profile_field)
    camera_profiles = profiles(camera.get("profiles", missing_profile_field), camera_selection,
                               "INVALID_PRESENTATION_STATE",
                               "Presentation camera profiles")
    require(camera_selection == parameter_selection,
            "INVALID_PRESENTATION_STATE",
            "Presentation profile selection differs between state and binding")
    require(camera_profiles == parameter_profiles, "INVALID_PRESENTATION_STATE",
            "Presentation profiles differ between state and binding")
    background = packet.get("background")
    if "background" in packet:
        require(background is not None, "INVALID_PRESENTATION_STATE",
                "Presentation background must be an object when present")
        background = strict_keys(background,
                                 {"resource", "opacity", "position", "repeat", "size"},
                                 "INVALID_PRESENTATION_STATE", "presentation background")
        require(set(background) == {"resource", "opacity", "position", "repeat", "size"},
                "INVALID_PRESENTATION_STATE", "Presentation background is incomplete")
        resource_id(background.get("resource"), "presentation background resource")
        require(not isinstance(background.get("opacity"), bool)
                and isinstance(background.get("opacity"), (int, float))
                and math.isfinite(background["opacity"]) and 0 <= background["opacity"] <= 1,
                "INVALID_PRESENTATION_STATE", "Presentation background opacity is invalid")
        for key in ("position", "repeat", "size"):
            safe_style(background.get(key), f"Presentation background {key}")
    expected_sinks = ["style.height", "style.left", "style.top", "style.transform"]
    if has_cursor_layer:
        expected_sinks.append("style.visibility")
    expected_sinks.append("style.width")
    exact_array(binding.get("sinks"), expected_sinks, "INVALID_PRESENTATION_BINDING",
                "Presentation sinks are incomplete or noncanonical")
    return packet


def validate_playback_profile_timeline_closure(playback_packet: dict,
                                               presentation_packet: dict) -> None:
    timeline_groups = ([playback_packet["profileTimelines"]]
                       if "profileTimelines" in playback_packet else [])
    timeline_groups.extend(bank["profileTimelines"] for bank in playback_packet.get("banks", [])
                           if "profileTimelines" in bank)
    if not timeline_groups:
        return
    profiles = presentation_packet["camera"].get("profiles")
    require(profiles is not None, "MISSING_POLYCSS_CHANNEL",
            "Playback profile timelines require static-presentation profiles")
    profile_indices = {profile["id"]: index for index, profile in enumerate(profiles)}
    for timelines in timeline_groups:
        previous_index = -1
        for timeline in timelines:
            profile_id = timeline["profileId"]
            require(profile_id in profile_indices, "INVALID_PLAYBACK_STATE",
                    f"Playback profile timeline {profile_id} has no static-presentation profile")
            profile_index = profile_indices[profile_id]
            require(profile_index > previous_index, "INVALID_PLAYBACK_STATE",
                    "Playback profile timelines do not follow static-presentation profile order")
            previous_index = profile_index


def validate_interaction_contract(state_channel: dict, binding: dict,
                                  binding_inputs: dict[str, dict],
                                  playback_state: dict,
                                  playback_binding: dict | None,
                                  presentation_binding: dict | None,
                                  limits: dict[str, int]) -> dict:
    state_code = "INVALID_INTERACTION_STATE"
    binding_code = "INVALID_INTERACTION_BINDING"
    expected_inputs = ["axis.x", "axis.y", "button.hold", "pointer.positioned",
                       "pointer.pressed", "pointer.x", "pointer.y"]
    exact_array(binding.get("inputs"), expected_inputs, binding_code,
                "Interaction inputs are incomplete or noncanonical")
    for input_id, input_type, default in (
        ("axis.x", "float", 0), ("axis.y", "float", 0),
        ("button.hold", "boolean", False),
        ("pointer.positioned", "boolean", False),
        ("pointer.pressed", "boolean", False),
    ):
        definition = binding_inputs.get(input_id, {})
        require(definition.get("type") == input_type and definition.get("default") == default,
                binding_code, f"Interaction input {input_id} has the wrong type or default")
    exact_array(binding.get("sinks"), ["style.transform", "style.visibility"],
                binding_code, "Interaction sinks are incomplete or noncanonical")
    targets = strict_keys(binding.get("targets"),
                          {"shapes", "leaves", "cursorLayer", "cursorStates"},
                          binding_code, "interaction targets")
    require(set(targets) == {"shapes", "leaves", "cursorLayer", "cursorStates"},
            binding_code, "Interaction targets are incomplete")
    shape_targets = unique_targets(targets.get("shapes"), limits["nodes"],
                                   binding_code, "interaction shape")
    leaf_targets = unique_targets(targets.get("leaves"), limits["nodes"],
                                  binding_code, "interaction leaf")
    if playback_binding is not None:
        require(shape_targets == playback_binding["targets"]["shapes"]
                and leaf_targets == playback_binding["targets"]["leaves"],
                "INTERACTION_TARGET_MISMATCH",
                "Interaction shape and leaf targets must exactly match playback")
    stable_id(targets.get("cursorLayer"), "interaction cursor layer")
    cursor_states = strict_keys(targets.get("cursorStates"), {"open", "closed"},
                                binding_code, "interaction cursor states")
    require(set(cursor_states) == {"open", "closed"}, binding_code,
            "Interaction cursor states are incomplete")
    opened = stable_id(cursor_states.get("open"), "interaction open cursor target")
    closed = stable_id(cursor_states.get("closed"), "interaction closed cursor target")
    require(opened != closed, binding_code, "Interaction cursor states must be distinct")
    parameters = strict_keys(binding.get("parameters"), {"initialFrame", "tickRateHz", "tickIntervalUs"},
                             binding_code, "interaction parameters")
    require("initialFrame" in parameters, binding_code,
            "Interaction parameters are incomplete or unsupported")
    validate_tick_cadence(parameters, binding_code, "Interaction")

    data = strict_keys(state_channel.get("data"), {"packet"}, state_code,
                       "interaction state data")
    packet = strict_keys(data.get("packet"), {"version", "arithmetic", "input",
                         "animator", "source", "triangle", "objects", "shapes",
                         "leaves", "controls"}, state_code, "interaction packet")
    require(set(data) == {"packet"}
            and set(packet) == {"version", "arithmetic", "input", "animator", "source",
                                "triangle", "objects", "shapes", "leaves", "controls"}
            and as_int(packet.get("version"), state_code, "interaction version") == 0
            and packet.get("arithmetic") == "ieee754-f32-per-operation", state_code,
            "Interaction packet is incomplete or unsupported")

    input_contract = strict_keys(packet.get("input"), {
        "sourceWidth", "sourceHeight", "cursorBounds", "cursorInitial",
        "pointerQuantization", "stickRange", "stickDeadzone", "stickScale",
        "grabButton", "holdButton", "hitRadius", "cursorVisibleTicks", "mirrorX",
    }, state_code, "interaction input contract")
    require(set(input_contract) == {
        "sourceWidth", "sourceHeight", "cursorBounds", "cursorInitial",
        "pointerQuantization", "stickRange", "stickDeadzone", "stickScale",
        "grabButton", "holdButton", "hitRadius", "cursorVisibleTicks", "mirrorX",
    }, state_code, "Interaction input contract is incomplete")
    require(is_safe_int(input_contract.get("sourceWidth"), 1)
            and is_safe_int(input_contract.get("sourceHeight"), 1), state_code,
            "Interaction source viewport is invalid")
    if presentation_binding is not None:
        require(input_contract["sourceWidth"] == presentation_binding["parameters"]["sourceWidth"]
                and input_contract["sourceHeight"] == presentation_binding["parameters"]["sourceHeight"],
                "INTERACTION_VIEWPORT_MISMATCH",
                "Interaction source viewport must match static presentation")
    pointer_defaults = {
        "pointer.x": input_contract["sourceWidth"] / 2,
        "pointer.y": input_contract["sourceHeight"] / 2,
    }
    for input_id, default in pointer_defaults.items():
        definition = binding_inputs.get(input_id, {})
        require(definition.get("type") == "float" and definition.get("default") == default,
                binding_code,
                f"Interaction input {input_id} must use source-centre default {default}")
    bounds = finite_f32_array(input_contract.get("cursorBounds"), 4, state_code,
                              "interaction cursor bounds")
    require(bounds[0] <= bounds[1] and bounds[2] <= bounds[3], state_code,
            "Interaction cursor bounds are unordered")
    initial_cursor = finite_f32_array(input_contract.get("cursorInitial"), 2, state_code,
                                      "interaction initial cursor")
    require(initial_cursor == [pointer_defaults["pointer.x"], pointer_defaults["pointer.y"]],
            "INTERACTION_VIEWPORT_MISMATCH",
            "Interaction initial cursor must equal source-centre pointer defaults")
    require(bounds[0] <= initial_cursor[0] <= bounds[1]
            and bounds[2] <= initial_cursor[1] <= bounds[3], state_code,
            "Interaction initial cursor is outside its bounds")
    require(input_contract.get("pointerQuantization") == "trunc-toward-zero-then-clamp",
            state_code, "Interaction pointer quantization is unsupported")
    stick_range = finite_f32_array(input_contract.get("stickRange"), 2, state_code,
                                   "interaction stick range")
    require(stick_range == [-128, 127], state_code,
            "Interaction stick range must be the fixed -128..127 range")
    require(finite_f32(input_contract.get("stickDeadzone"))
            and input_contract["stickDeadzone"] >= 0
            and finite_f32(input_contract.get("stickScale"))
            and input_contract["stickScale"] > 0, state_code,
            "Interaction stick scaling is invalid")
    grab_button, hold_button = input_contract.get("grabButton"), input_contract.get("holdButton")
    require(is_safe_int(grab_button, 1, 0xffff) and is_safe_int(hold_button, 1, 0xffff)
            and (int(grab_button) & int(hold_button)) == 0, state_code,
            "Interaction button masks are invalid")
    require(finite_f32(input_contract.get("hitRadius")) and input_contract["hitRadius"] > 0
            and is_safe_int(input_contract.get("cursorVisibleTicks"), 1)
            and finite_f32(input_contract.get("mirrorX")), state_code,
            "Interaction picking or cursor timing is invalid")

    animator_keys = {"dozeState", "sleepState", "wakeState", "convergeState", "exitEyeState",
                     "eyeState", "dozeLoopCount", "dozeLoopStartFrame",
                     "dozeLoopEndFrame", "sleepEndFrame", "wakeStartFrame", "eyeFrame",
                     "convergeStillTicks", "eyeStillTicks"}
    animator = strict_keys(packet.get("animator"), animator_keys, state_code,
                           "interaction animator")
    require(set(animator) == animator_keys
            and all(is_safe_int(animator[key], 0) for key in animator_keys), state_code,
            "Interaction animator contains invalid integers")
    state_ids = [animator[key] for key in ("dozeState", "sleepState", "wakeState",
                                           "convergeState", "exitEyeState",
                                           "eyeState")]
    require(len(set(state_ids)) == len(state_ids),
            state_code, "Interaction animator states are invalid")
    playback_frame_count = (playback_binding["parameters"]["frameCount"]
                            if playback_binding is not None else limits["frames"])
    require(0 < animator["eyeFrame"] <= playback_frame_count, state_code,
            "Interaction eye frame is invalid")
    require(animator["dozeLoopCount"] > 0
            and 0 < animator["dozeLoopStartFrame"] < animator["dozeLoopEndFrame"] <= playback_frame_count
            and 0 < animator["sleepEndFrame"] <= playback_frame_count
            and 0 < animator["wakeStartFrame"] <= playback_frame_count
            and animator["convergeStillTicks"] > 0 and animator["eyeStillTicks"] > 0,
            state_code, "Interaction animator timing is invalid")
    require(parameters.get("initialFrame") == animator["eyeFrame"], binding_code,
            "Interaction binding initialFrame differs from animator eye frame")

    source = strict_keys(packet.get("source"), {"cameraViewMatrix", "cameraWorldPosition",
                         "inverseCameraMatrix", "projection", "displacementMagnitude",
                         "eyeGain", "eyeMaximumOffset", "spring"}, state_code,
                         "interaction source")
    require(set(source) == {"cameraViewMatrix", "cameraWorldPosition", "inverseCameraMatrix",
                            "projection", "displacementMagnitude", "eyeGain",
                            "eyeMaximumOffset", "spring"}, state_code,
            "Interaction source contract is incomplete")
    camera_view = finite_f32_array(source.get("cameraViewMatrix"), 16, state_code,
                                   "interaction camera view matrix")
    camera_inverse = finite_f32_array(source.get("inverseCameraMatrix"), 16, state_code,
                                      "interaction inverse camera matrix")
    require(inverse_matrix_pair(camera_view, camera_inverse), state_code,
            "Interaction camera matrices are not a finite inverse pair")
    finite_f32_array(source.get("cameraWorldPosition"), 3, state_code,
                     "interaction camera world position")
    projection = strict_keys(source.get("projection"), {"scale", "origin"}, state_code,
                             "interaction projection")
    require(set(projection) == {"scale", "origin"}
            and finite_f32(projection.get("scale")) and projection["scale"] > 0,
            state_code, "Interaction projection is invalid")
    finite_f32_array(projection.get("origin"), 2, state_code,
                     "interaction projection origin")
    require(finite_f32(source.get("displacementMagnitude"))
            and source["displacementMagnitude"] > 0
            and finite_f32(source.get("eyeGain")) and source["eyeGain"] > 0
            and finite_f32(source.get("eyeMaximumOffset"))
            and source["eyeMaximumOffset"] >= 0, state_code,
            "Interaction displacement or eye values are invalid")
    spring_keys = {"cursorResistance", "grabbedFlag", "pickedResistance",
                   "releaseAcceleration", "snapOffsetL1", "snapVelocityL1", "velocityDecay"}
    spring = strict_keys(source.get("spring"), spring_keys, state_code,
                         "interaction spring")
    require(set(spring) == spring_keys
            and all(finite_f32(spring[key]) for key in spring_keys - {"grabbedFlag"})
            and 0 <= spring["cursorResistance"] <= 1
            and -1 <= spring["pickedResistance"] < 0
            and 0 < spring["releaseAcceleration"] <= 1
            and 0 < spring["velocityDecay"] < 1
            and spring["snapOffsetL1"] >= 0 and spring["snapVelocityL1"] >= 0
            and is_safe_int(spring.get("grabbedFlag"), 1), state_code,
            "Interaction spring constraints are invalid")
    grab_displacement_bounds = interaction_grab_displacement_bounds(input_contract, source)
    require(grab_displacement_bounds is not None, state_code,
            "Declared cursor displacement overflows interaction binary32 arithmetic")
    selected_grab_bounds = [interaction_f32(bound / -spring["pickedResistance"])
                            for bound in grab_displacement_bounds]
    require(all(math.isfinite(bound) for bound in selected_grab_bounds), state_code,
            "Declared selected-grab envelope overflows interaction binary32 arithmetic")

    triangle = strict_keys(packet.get("triangle"),
                           {"basisEpsilon", "primitive", "fallbackAmount", "sharedEdgeAmount"},
                           state_code, "interaction triangle kernel")
    require(set(triangle) == {"basisEpsilon", "primitive", "fallbackAmount",
                              "sharedEdgeAmount"}
            and triangle.get("basisEpsilon") == 1e-9
            and triangle.get("primitive") == "corner-bevel"
            and finite_f32(triangle.get("fallbackAmount"))
            and triangle["fallbackAmount"] >= 0
            and finite_f32(triangle.get("sharedEdgeAmount"))
            and triangle["sharedEdgeAmount"] >= 0, state_code,
            "Interaction triangle kernel is unsupported")

    objects = strict_keys(packet.get("objects"), {"rotationMatrices"}, state_code,
                          "interaction objects")
    rotations = objects.get("rotationMatrices")
    require(set(objects) == {"rotationMatrices"} and isinstance(rotations, list)
            and len(rotations) % 16 == 0
            and len(rotations) // 16 <= limits["interaction_objects"]
            and all(finite_f32(value) for value in rotations),
            "INTERACTION_STATE_LIMIT", "Interaction object matrices are invalid or excessive")
    object_count = len(rotations) // 16
    shapes = strict_keys(packet.get("shapes"), {"baseMatrices"}, state_code,
                         "interaction shapes")
    base_matrices = shapes.get("baseMatrices")
    require(set(shapes) == {"baseMatrices"} and isinstance(base_matrices, list)
            and len(base_matrices) == len(shape_targets) * 16
            and all(finite_f32(value) for value in base_matrices),
            "TARGET_CARDINALITY_MISMATCH",
            "Interaction shape matrices do not match targets")
    leaf_plans = packet.get("leaves")
    require(isinstance(leaf_plans, list) and len(leaf_plans) == len(leaf_targets)
            and len(leaf_plans) <= limits["nodes"], "TARGET_CARDINALITY_MISMATCH",
            "Interaction leaf plans do not match targets")
    for index, leaf in enumerate(leaf_plans):
        leaf = strict_keys(leaf, {"basis", "canonicalSize", "matrixDecimals",
                           "seamEdgeMask", "width", "height"}, state_code,
                           f"interaction leaf {index}")
        require(set(leaf) == {"basis", "canonicalSize", "matrixDecimals", "seamEdgeMask",
                              "width", "height"}
                and leaf.get("basis") in ([0, 1, 2], [1, 2, 0], [2, 0, 1])
                and leaf.get("canonicalSize") == 32
                and is_safe_int(leaf.get("matrixDecimals"), 0, 6)
                and is_safe_int(leaf.get("seamEdgeMask"), 0, 7)
                and is_safe_int(leaf.get("width"), 1)
                and is_safe_int(leaf.get("height"), 1), state_code,
                f"Interaction leaf {index} is invalid")
        if playback_state is not None:
            require(playback_state["data"]["leafFit"][index]["canonicalSize"] == 32,
                    "INTERACTION_TARGET_MISMATCH",
                    f"Interaction leaf {index} does not match playback's fixed triangle basis")

    controls = packet.get("controls")
    require(isinstance(controls, list) and 0 < len(controls) <= limits["interaction_controls"],
            "INTERACTION_STATE_LIMIT", "Interaction controls are missing or excessive")
    control_ids, control_roles = set(), set()
    total_vertices = total_weights = total_weight_references = total_leaf_rows = grab_controls = 0
    for control_index, control in enumerate(controls):
        control = strict_keys(control, {"id", "role", "mode", "sourceOrder",
                              "sourcePosition", "screenPosition", "cameraDistance",
                              "attachmentObjectIndices", "closure"}, state_code,
                              f"interaction control {control_index}")
        require(set(control) == {"id", "role", "mode", "sourceOrder", "sourcePosition",
                                 "screenPosition", "cameraDistance",
                                 "attachmentObjectIndices", "closure"}, state_code,
                f"Interaction control {control_index} is incomplete")
        control_id = stable_id(control.get("id"), f"interaction control {control_index} id")
        role = stable_id(control.get("role"), f"interaction control {control_index} role")
        require(control_id not in control_ids and role not in control_roles, state_code,
                "Interaction control ids and roles must be unique")
        control_ids.add(control_id); control_roles.add(role)
        mode = control.get("mode")
        require(control.get("sourceOrder") == control_index
                and mode in ("grab", "eye-follow"), state_code,
                f"Interaction control {control_index} mode or order is invalid")
        if mode == "grab":
            grab_controls += 1
        source_position = finite_f32_array(control.get("sourcePosition"), 3, state_code,
                                           f"interaction control {control_index} source position")
        finite_f32_array(control.get("screenPosition"), 2, state_code,
                         f"interaction control {control_index} screen position")
        require(finite_f32(control.get("cameraDistance")) and control["cameraDistance"] > 0,
                state_code, f"Interaction control {control_index} camera distance is invalid")
        attachments = integer_array(control.get("attachmentObjectIndices"),
                                    limits["interaction_objects"], state_code,
                                    f"interaction control {control_index} attachments", 0,
                                    max(0, object_count - 1), True)
        require(bool(attachments) and (mode != "eye-follow" or len(attachments) == 1),
                state_code, f"Interaction control {control_index} attachments are invalid")

        closure_keys = {"shapeIndices", "vertexRows", "vertexPositions",
                        "weightActiveFlags", "weightScalars", "weightLinearContributions",
                        "weightBaseTranslations", "leafIndices", "leafRows",
                        "safeVisibleLeafIndices", "rigidRootInverseMatrix"}
        closure = strict_keys(control.get("closure"), closure_keys, state_code,
                              f"interaction control {control_index} closure")
        require(set(closure) == closure_keys, state_code,
                f"Interaction control {control_index} closure is incomplete")
        shape_indices = integer_array(closure.get("shapeIndices"), len(shape_targets),
                                      state_code,
                                      f"interaction control {control_index} shape indices", 0,
                                      max(0, len(shape_targets) - 1), True)
        require(bool(shape_indices), state_code,
                f"Interaction control {control_index} has no shape closure")
        vertex_rows = closure.get("vertexRows")
        require(isinstance(vertex_rows, list) and len(vertex_rows) % 4 == 0,
                state_code, f"Interaction control {control_index} vertex rows are truncated")
        vertex_count = len(vertex_rows) // 4
        total_vertices += vertex_count
        vertex_positions = closure.get("vertexPositions")
        require(total_vertices <= limits["interaction_vertices"]
                and isinstance(vertex_positions, list)
                and len(vertex_positions) == vertex_count * 3
                and all(finite_f32(value) for value in vertex_positions),
                "INTERACTION_STATE_LIMIT",
                f"Interaction control {control_index} vertices are invalid or excessive")
        shape_set, maximum_weight = set(shape_indices), 0
        for row in range(vertex_count):
            offset = row * 4
            values = vertex_rows[offset:offset + 4]
            require(len(values) == 4 and values[0] in shape_set
                    and all(is_safe_int(value, 0) for value in values[1:]), state_code,
                    f"Interaction control {control_index} vertex row {row} is invalid")
            row_end = int(values[2]) + int(values[3])
            require(is_safe_int(row_end, 0), state_code,
                    f"Interaction control {control_index} weight range overflows")
            maximum_weight = max(maximum_weight, row_end)
            total_weight_references += int(values[3])
            require(total_weight_references <= limits["interaction_weight_references"],
                    "INTERACTION_STATE_LIMIT", "Interaction weight references are excessive")
        weight_scalars = closure.get("weightScalars")
        weight_flags = closure.get("weightActiveFlags")
        weight_linear = closure.get("weightLinearContributions")
        weight_base = closure.get("weightBaseTranslations")
        require(all(isinstance(value, list) for value in
                    (weight_scalars, weight_flags, weight_linear, weight_base)),
                "INTERACTION_STATE_LIMIT", "Interaction weight tables must be arrays")
        weight_count = len(weight_scalars)
        total_weights += weight_count
        require(total_weights <= limits["interaction_weights"]
                and maximum_weight <= weight_count
                and len(weight_flags) == weight_count
                and len(weight_linear) == weight_count * 3
                and len(weight_base) == weight_count * 3
                and all(finite_f32(value) for value in weight_scalars)
                and all(finite_f32(value) for value in weight_linear)
                and all(finite_f32(value) for value in weight_base)
                and all(value in (0, 1) and not isinstance(value, bool)
                        for value in weight_flags), "INTERACTION_STATE_LIMIT",
                f"Interaction control {control_index} weight tables are invalid or excessive")
        reconstruction_bounds = ([source["eyeMaximumOffset"]] * 3
                                 if mode == "eye-follow" else selected_grab_bounds)
        for row in range(vertex_count):
            for component in range(3):
                require(interaction_reconstruction_is_finite(
                            closure, row, component, reconstruction_bounds[component]),
                        state_code,
                        f"Interaction control {control_index} vertex {row} reconstruction can overflow")
        leaf_indices = integer_array(closure.get("leafIndices"), len(leaf_plans), state_code,
                                     f"interaction control {control_index} leaf indices", 0,
                                     max(0, len(leaf_plans) - 1), True)
        leaf_rows = closure.get("leafRows")
        require(isinstance(leaf_rows, list) and len(leaf_rows) == len(leaf_indices) * 4,
                state_code, f"Interaction control {control_index} leaf rows are mismatched")
        total_leaf_rows += len(leaf_indices)
        require(total_leaf_rows <= limits["interaction_leaf_rows"],
                "INTERACTION_STATE_LIMIT", "Interaction leaf rows are excessive")
        for row, leaf_index in enumerate(leaf_indices):
            values = leaf_rows[row * 4:row * 4 + 4]
            require(len(values) == 4 and all(is_safe_int(value, 0) for value in values)
                    and values[0] == leaf_index
                    and all(value < vertex_count for value in values[1:]), state_code,
                    f"Interaction control {control_index} leaf row {row} is invalid")
        safe_visible = integer_array(closure.get("safeVisibleLeafIndices"),
                                     len(leaf_indices), state_code,
                                     f"interaction control {control_index} safe-visible leaves",
                                     0, max(0, len(leaf_plans) - 1), True)
        require(all(index in set(leaf_indices) for index in safe_visible), state_code,
                f"Interaction control {control_index} safe-visible leaves escape closure")
        rigid_inverse = closure.get("rigidRootInverseMatrix")
        if mode == "eye-follow":
            finite_f32_array(rigid_inverse, 16, state_code,
                             f"interaction control {control_index} rigid inverse matrix")
            rotation_offset = attachments[0] * 16
            rotation = rotations[rotation_offset:rotation_offset + 16]
            require(interaction_eye_matrix_is_finite(
                        rotation, rigid_inverse, source["eyeMaximumOffset"]),
                    state_code,
                    f"Interaction eye control {control_index} matrix envelope can overflow")
            projected = interaction_projected_f32(source_position, source)
            require(projected is not None, state_code,
                    f"Interaction eye control {control_index} projection overflows")
            for cursor_x in (bounds[0], bounds[1]):
                for cursor_y in (bounds[2], bounds[3]):
                    eye_offset = [
                        interaction_mul_f32(
                            interaction_add_f32(cursor_x, -projected[0]), source["eyeGain"]),
                        interaction_mul_f32(
                            interaction_add_f32(projected[1], -cursor_y), source["eyeGain"]),
                        0.0,
                    ]
                    require(all(math.isfinite(component) for component in eye_offset)
                            and interaction_magnitude_f32(eye_offset), state_code,
                            f"Interaction eye control {control_index} offset overflows")
            camera = 0.0
            for component in (
                f32(f32(camera_view[2] * source_position[0])
                    + f32(camera_view[6] * source_position[1])),
                camera_view[10] * source_position[2], camera_view[14],
            ):
                camera = f32(camera + f32(component))
            require(math.isfinite(camera) and abs(camera) > 1e-6, state_code,
                    f"Interaction eye control {control_index} projects on camera plane")
        else:
            require(isinstance(rigid_inverse, list) and len(rigid_inverse) == 0, state_code,
                    f"Grab control {control_index} has a rigid inverse matrix")
            for component in range(3):
                require(math.isfinite(interaction_add_f32(
                            source_position[component], selected_grab_bounds[component]))
                        and math.isfinite(interaction_add_f32(
                            source_position[component], -selected_grab_bounds[component])),
                        state_code,
                        f"Interaction grab control {control_index} displacement envelope overflows")
    require(grab_controls > 0, state_code,
            "Prepared interaction needs at least one grab control")
    return packet


def validate_state_bindings(state: Any, bindings: Any, node_ids: set[str], limits: dict[str, int], tree_nodes: list[dict]) -> tuple[list[dict], list[dict]]:
    state = strict_keys(state, {"version", "channels"}, "INVALID_STATE", "STAT")
    require(as_int(state.get("version"), "UNSUPPORTED_STATE_SCHEMA", "STAT version") == 0,
            "UNSUPPORTED_STATE_SCHEMA", "STAT version must be zero")
    channels = state.get("channels")
    require(isinstance(channels, list) and len(channels) <= 128, "STATE_CHANNEL_LIMIT", "State channels invalid")
    state_map, previous = {}, ""
    for channel in channels:
        channel = strict_keys(channel, {"id", "codec", "data"}, "INVALID_STATE", "state channel")
        cid = stable_id(channel.get("id"), "state channel id")
        require(cid > previous and cid not in state_map, "STATE_CHANNEL_ORDER", "State channels not sorted")
        previous = cid
        require(channel.get("codec") in STATE_INTERPRETERS and "data" in channel,
                "UNSUPPORTED_STATE_CODEC", f"State codec for {cid} is unsupported")
        state_map[cid] = channel
    bindings = strict_keys(bindings, {"version", "inputs", "channels"}, "INVALID_BINDINGS", "BIND")
    require(as_int(bindings.get("version"), "UNSUPPORTED_BINDING_SCHEMA", "BIND version") == 0,
            "UNSUPPORTED_BINDING_SCHEMA", "BIND version must be zero")
    inputs, input_ids, input_map, previous = bindings.get("inputs"), set(), {}, ""
    require(isinstance(inputs, list) and len(inputs) <= limits["binding_inputs"],
            "BINDING_INPUT_LIMIT", "Binding inputs invalid or excessive")
    for item in inputs:
        item = strict_keys(item, {"id", "type", "default"}, "INVALID_BINDINGS", "binding input")
        iid = stable_id(item.get("id"), "binding input id")
        require(iid > previous and iid not in input_ids and item.get("type") in ("boolean", "float", "uint"),
                "INPUT_ORDER", "Binding inputs invalid or unsorted")
        if "default" in item:
            default = item["default"]
            valid_default = ((item["type"] == "boolean" and isinstance(default, bool))
                             or (item["type"] == "float" and not isinstance(default, bool)
                                 and isinstance(default, (int, float)) and math.isfinite(default))
                             or (item["type"] == "uint" and not isinstance(default, bool)
                                 and isinstance(default, (int, float)) and math.isfinite(default)
                                 and float(default).is_integer()
                                 and 0 <= default <= 9_007_199_254_740_991))
            require(valid_default, "INVALID_INPUT_DEFAULT", f"Binding input {iid} default is invalid")
        input_map[iid] = item
        previous, _ = iid, input_ids.add(iid)
    binding_channels = bindings.get("channels")
    require(isinstance(binding_channels, list) and len(binding_channels) <= 128,
            "BINDING_CHANNEL_LIMIT", "Binding channels invalid")
    bound, interpreters, used_inputs, previous = set(), set(), set(), ""
    for channel in binding_channels:
        channel = strict_keys(channel, {"id", "state", "interpreter", "status", "inputs", "targets", "sinks", "parameters"},
                              "INVALID_BINDINGS", "binding channel")
        cid = stable_id(channel.get("id"), "binding channel id")
        require(cid > previous, "BINDING_CHANNEL_ORDER", "Binding channels not sorted")
        previous = cid
        sid, interpreter = channel.get("state"), channel.get("interpreter")
        require(sid in state_map and STATE_INTERPRETERS[state_map[sid]["codec"]] == interpreter,
                "STATE_INTERPRETER_MISMATCH", f"Binding {cid} state/interpreter mismatch")
        require(sid not in bound and interpreter not in interpreters,
                "DUPLICATE_STATE_BINDING", f"Binding {cid} duplicates state/interpreter")
        bound.add(sid); interpreters.add(interpreter)
        require(channel.get("status") == "executable", "INVALID_BINDING_STATUS", "Binding status must be executable")
        channel_inputs = channel.get("inputs")
        require(isinstance(channel_inputs, list)
                and len(channel_inputs) <= limits["binding_inputs"]
                and all(isinstance(value, str) and value in input_ids for value in channel_inputs)
                and len(set(channel_inputs)) == len(channel_inputs),
                "MISSING_INPUT", f"Binding {cid} inputs invalid")
        used_inputs.update(channel_inputs)
        target_list: list[str] = []
        require(isinstance(channel.get("targets"), dict), "INVALID_TARGETS", f"Binding {cid} targets invalid")
        collect_targets(channel["targets"], target_list, len(node_ids) + 1,
                        f"Binding {cid} targets", limits["depth"])
        require((target_list or interpreter == "polycss-surface@0")
                and len(set(target_list)) == len(target_list)
                and all(target == "$host" or target in node_ids for target in target_list),
                "MISSING_TARGET_NODE", f"Binding {cid} targets invalid")
        sinks = channel.get("sinks")
        require(isinstance(sinks, list) and sinks and len(sinks) <= len(ALLOWED_SINKS)
                and all(isinstance(sink, str) and sink in ALLOWED_SINKS for sink in sinks)
                and len(set(sinks)) == len(sinks),
                "UNSUPPORTED_SINK", f"Binding {cid} sinks invalid")
    require(bound == set(state_map), "UNBOUND_STATE_CHANNEL", "A state channel is unbound")
    require(used_inputs == input_ids, "UNUSED_INPUT", "A binding input is declared but unused")
    # Independent codec-envelope/cardinality checks.
    by_codec = {channel["codec"]: channel for channel in channels}
    by_interpreter = {channel["interpreter"]: channel for channel in binding_channels}
    binding_contracts = {
        "polycss-compositor-timing@0": (
            ["time.source-frame", "time.tick"], ["style.transform"],
            {"nodes"}, {"frameCount", "tickRateHz", "tickIntervalUs"}),
        "polycss-effects@0": (
            ["interaction.grab-active", "interaction.grab-x", "interaction.grab-y", "interaction.grab-z", "time.source-frame"],
            ["style.backgroundPosition", "style.opacity", "style.transform", "style.visibility"],
            {"stars", "emitters"}, {"frameCount"}),
        "polycss-playback@0": (
            ["time.tick"], ["style.transform", "style.visibility"],
            {"model", "shapes", "leaves"}, {"baseSceneTransform", "frameCount", "tickRateHz", "tickIntervalUs", "catchUpPolicy"}),
        "polycss-paged-playback@0": (
            ["time.tick"], ["style.transform", "style.visibility"],
            {"model", "shapes", "leaves"}, {"baseSceneTransform", "frameCount", "tickRateHz", "tickIntervalUs", "catchUpPolicy"}),
        "polycss-pointer-grab@0": (
            ["axis.x", "axis.y", "button.hold", "pointer.positioned", "pointer.pressed", "pointer.x", "pointer.y"],
            ["style.transform", "style.visibility"],
            {"shapes", "leaves", "cursorLayer", "cursorStates"}, {"initialFrame", "tickRateHz", "tickIntervalUs"}),
        "polycss-surface@0": (
            ["time.source-frame"], None,
            {"leaves"}, None),
        "polycss-variants@0": (
            ["time.source-frame"], None,
            {"effectNodes", "nodes"}, None),
        "polycss-paged-variants@0": (
            ["time.source-frame"], None,
            {"effectNodes", "nodes"}, None),
        "polycss-orbit-input@0": (
            ["orbit.pitch", "orbit.yaw", "orbit.zoom"],
            ["style.backgroundPosition", "style.transform"],
            {"model", "leaves"}, None),
        "polycss-viewport-profiles@0": (
            ["viewport.height", "viewport.width"],
            ["style.transform", "style.visibility"],
            {"leaves"}, None),
    }
    for interpreter, (expected_inputs, expected_sinks, target_keys, parameter_keys) in binding_contracts.items():
        binding = by_interpreter.get(interpreter)
        if binding is None:
            continue
        require(binding["status"] == "executable" and binding["inputs"] == expected_inputs
                and (expected_sinks is None or binding["sinks"] == expected_sinks),
                "INVALID_CODEC_BINDING", f"{interpreter} input, sink, or status contract is invalid")
        targets = strict_keys(binding["targets"], target_keys, "INVALID_CODEC_BINDING", f"{interpreter} targets")
        require(set(targets) == target_keys, "INVALID_CODEC_BINDING", f"{interpreter} targets are incomplete")
        if parameter_keys is None:
            require("parameters" not in binding, "INVALID_CODEC_BINDING", f"{interpreter} has no parameters")
        else:
            parameters = strict_keys(binding.get("parameters"), parameter_keys, "INVALID_CODEC_BINDING", f"{interpreter} parameters")
            timing_required = {
                "polycss-compositor-timing@0": {"frameCount"},
                "polycss-playback@0": {"baseSceneTransform", "frameCount"},
                "polycss-paged-playback@0": {"baseSceneTransform", "frameCount"},
                "polycss-pointer-grab@0": {"initialFrame"},
            }
            require(timing_required.get(interpreter, parameter_keys) <= set(parameters),
                    "INVALID_CODEC_BINDING", f"{interpreter} parameters are incomplete")

    inline_playback_state = by_codec.get("polycss-playback-packed@0")
    paged_playback_state = by_codec.get("polycss-paged-playback@0")
    surface_state = by_codec.get("polycss-surface-packed@0")
    variant_state = by_codec.get("polycss-variants-packed@0")
    paged_variant_state = by_codec.get("polycss-paged-variants@0")
    compositor_state = by_codec.get("polycss-compositor-timing-prepared@0")
    orbit_state = by_codec.get("polycss-orbit-input-prepared@0")
    viewport_state = by_codec.get("polycss-viewport-profiles-packed@0")
    inline_playback_binding = by_interpreter.get("polycss-playback@0")
    paged_playback_binding = by_interpreter.get("polycss-paged-playback@0")
    playback_state = inline_playback_state or paged_playback_state
    playback_binding = inline_playback_binding or paged_playback_binding
    surface_binding = by_interpreter.get("polycss-surface@0")
    variant_binding = by_interpreter.get("polycss-variants@0")
    paged_variant_binding = by_interpreter.get("polycss-paged-variants@0")
    compositor_binding = by_interpreter.get("polycss-compositor-timing@0")
    orbit_binding = by_interpreter.get("polycss-orbit-input@0")
    viewport_binding = by_interpreter.get("polycss-viewport-profiles@0")
    require((inline_playback_state is None) == (inline_playback_binding is None)
            and (paged_playback_state is None) == (paged_playback_binding is None),
            "MISSING_POLYCSS_CHANNEL", "Playback state and binding must appear together")
    require(not (inline_playback_binding and paged_playback_binding),
            "TARGET_OWNERSHIP_CONFLICT", "Inline and paged playback are mutually exclusive")
    require((surface_state is None) == (surface_binding is None),
            "MISSING_POLYCSS_CHANNEL", "Surface state and binding must appear together")
    require((variant_state is None) == (variant_binding is None),
            "MISSING_POLYCSS_CHANNEL", "Variant state and binding must appear together")
    require((paged_variant_state is None) == (paged_variant_binding is None)
            and (compositor_state is None) == (compositor_binding is None)
            and (orbit_state is None) == (orbit_binding is None)
            and (viewport_state is None) == (viewport_binding is None),
            "MISSING_POLYCSS_CHANNEL", "New prepared state and binding channels must appear together")
    require(not (variant_binding and paged_variant_binding), "TARGET_OWNERSHIP_CONFLICT",
            "Inline and paged variants cannot race class ownership")
    playback_packet = None
    if playback_binding is not None:
        playback_packet = (validate_playback_contract(
            playback_state, playback_binding, input_map, limits)
            if inline_playback_binding is not None else validate_paged_playback_contract(
                playback_state, playback_binding, input_map, limits))
    if surface_binding is not None:
        require(playback_packet is not None, "MISSING_POLYCSS_CHANNEL",
                "Prepared surface requires executable playback")
        validate_surface_contract(surface_state, surface_binding, playback_packet,
                                  playback_binding, input_map, limits)
    if compositor_binding is not None:
        require(playback_packet is not None, "MISSING_POLYCSS_CHANNEL",
                "Compositor timing requires executable playback")
        require(inline_playback_binding is not None, "TARGET_OWNERSHIP_CONFLICT",
                "Compositor timing version 0 cannot reference page-local playback transforms")
        validate_compositor_timing_contract(compositor_state, compositor_binding,
                                            playback_packet, playback_binding,
                                            input_map, limits)
    if playback_packet is not None and playback_packet["leafCount"] > 0:
        require(surface_binding is not None, "MISSING_POLYCSS_CHANNEL",
                "Playback with leaf targets requires prepared surface state and binding")
    if variant_binding is not None:
        require(playback_packet is not None, "MISSING_POLYCSS_CHANNEL",
                "Prepared variants require executable playback")
        validate_variants_contract(variant_state, variant_binding, playback_packet,
                                   playback_binding, input_map, limits, tree_nodes, surface_binding)
    paged_variant_packet = None
    if paged_variant_binding is not None:
        require(playback_packet is not None, "MISSING_POLYCSS_CHANNEL",
                "Paged variants require executable playback")
        paged_variant_packet = validate_paged_variants_contract(
            paged_variant_state, paged_variant_binding, playback_packet,
            playback_binding, input_map, limits, tree_nodes, surface_binding)
    paged_packets = [packet for packet in (playback_packet if paged_playback_binding else None,
                                           paged_variant_packet) if packet is not None]
    if paged_packets:
        ceiling = paged_packets[0]["maxResidentPages"]
        bank_entry_frames = [bank["entryFrame"] for bank in playback_packet.get("banks", [])]
        require(all(packet["maxResidentPages"] == ceiling for packet in paged_packets),
                "STATE_PAGE_RESIDENCY_LIMIT",
                "Every paged state channel must declare the same resident-page ceiling")
        require(ceiling >= required_document_state_residency(
                    paged_packets, [playback_packet["initial"]["sourceFrame"]],
                    bank_entry_frames),
                "STATE_PAGE_RESIDENCY_LIMIT",
                "Paged state channels cannot satisfy the combined lookahead, fixed-pin, and prepared-bank transfer window")

    effects_state = by_codec.get("polycss-effects-prepared@0")
    effects_binding = by_interpreter.get("polycss-effects@0")
    if effects_state or effects_binding:
        require(effects_state is not None and effects_binding is not None,
                "MISSING_POLYCSS_CHANNEL",
                "Effects state and binding must appear together")
        require(playback_binding is not None, "MISSING_POLYCSS_CHANNEL",
                "Prepared effects require executable playback")
        require(playback_binding["parameters"].get("catchUpPolicy") != "elapsed",
                "INVALID_EFFECTS_BINDING",
                "Prepared effects do not support collapsed elapsed catch-up")
        validate_effects_contract(effects_state, effects_binding, input_map,
                                  playback_binding, limits)

    presentation_state = by_codec.get("static-presentation@0")
    presentation_binding = by_interpreter.get("static-presentation@0")
    presentation_packet = None
    if presentation_state or presentation_binding:
        require(presentation_state is not None and presentation_binding is not None,
                "MISSING_POLYCSS_CHANNEL",
                "Presentation state and binding must appear together")
        presentation_packet = validate_presentation_contract(presentation_state, presentation_binding, input_map)

    if (playback_packet is not None
            and ("profileTimelines" in playback_packet
                 or any("profileTimelines" in bank for bank in playback_packet.get("banks", [])))):
        require(presentation_packet is not None, "MISSING_POLYCSS_CHANNEL",
                "Playback profile timelines require static presentation")
        validate_playback_profile_timeline_closure(playback_packet, presentation_packet)

    if orbit_binding is not None:
        require(playback_binding is None, "TARGET_OWNERSHIP_CONFLICT",
                "Prepared orbit version 0 cannot race playback")
        validate_orbit_contract(orbit_state, orbit_binding, presentation_packet,
                                input_map, tree_nodes, limits)
    if viewport_binding is not None:
        require(playback_packet is not None and presentation_packet is not None,
                "MISSING_POLYCSS_CHANNEL", "Viewport profiles require playback and presentation")
        validate_viewport_profiles_contract(viewport_state, viewport_binding,
                                            playback_packet, playback_binding,
                                            presentation_packet, input_map, limits)

    interaction_state = by_codec.get("polycss-pointer-grab-prepared@0")
    interaction_binding = by_interpreter.get("polycss-pointer-grab@0")
    if interaction_state or interaction_binding:
        require(interaction_state is not None and interaction_binding is not None,
                "MISSING_POLYCSS_CHANNEL",
                "Interaction state and binding must appear together")
        require(playback_binding is not None and presentation_binding is not None
                and effects_binding is not None, "MISSING_POLYCSS_CHANNEL",
                "Prepared pointer interaction requires playback, presentation, and effects")
        validate_interaction_contract(interaction_state, interaction_binding, input_map,
                                      inline_playback_state, playback_binding,
                                      presentation_binding, limits)
        require(same_tick_cadence(interaction_binding["parameters"], playback_binding["parameters"])
                and playback_binding["parameters"].get("catchUpPolicy") != "elapsed",
                "INVALID_INTERACTION_BINDING",
                "Interaction and playback timing is incompatible")
        if paged_packets:
            required_resident_pages = required_document_state_residency(
                paged_packets,
                [playback_packet["initial"]["sourceFrame"],
                 interaction_binding["parameters"]["initialFrame"]],
                [bank["entryFrame"] for bank in playback_packet.get("banks", [])])
            require(paged_packets[0]["maxResidentPages"] >= required_resident_pages,
                    "STATE_PAGE_RESIDENCY_LIMIT",
                    "Paged state with interaction must reserve both entry pages and every combined cyclic lookahead window")

    def target_set(binding: dict) -> set[str]:
        values: list[str] = []
        collect_targets(binding["targets"], values, limits["nodes"] + 1,
                        f"{binding['interpreter']} targets", limits["depth"])
        return set(values)

    if effects_binding is not None:
        effect_targets = target_set(effects_binding)
        for other in binding_channels:
            if other is effects_binding:
                continue
            overlap = effect_targets.intersection(target_set(other))
            require(not overlap, "TARGET_OWNERSHIP_CONFLICT",
                    f"Effect targets overlap {other['interpreter']}: {sorted(overlap)[0] if overlap else ''}")
    if playback_binding is not None and presentation_binding is not None:
        playback_targets = target_set(playback_binding)
        overlap = {target for target in target_set(presentation_binding)
                   if target != "$host" and target in playback_targets}
        require(not overlap, "TARGET_OWNERSHIP_CONFLICT",
                f"Presentation targets overlap playback: {sorted(overlap)[0] if overlap else ''}")
    return channels, binding_channels


def css_number(value: Any) -> str:
    if isinstance(value, int):
        return str(value)
    return ecma_number(float(value))


def validate_initial_surface_closure(document: dict[str, Any], nodes: list[dict]) -> None:
    state = next((channel for channel in document["state"]["channels"]
                  if channel["codec"] == "polycss-surface-packed@0"), None)
    binding = next((channel for channel in document["bindings"]["channels"]
                    if channel["interpreter"] in ("polycss-playback@0",
                                                   "polycss-paged-playback@0")), None)
    if state is None or binding is None:
        return
    packet = state["data"]["packet"]
    try:
        packed = base64.b64decode(packet["visibility"]["initialVisibleBitsBase64"],
                                  validate=True)
    except (binascii.Error, ValueError) as error:
        raise DomError("INVALID_SURFACE_STATE",
                       "Surface initial visibility is not valid base64") from error
    by_id = {node["id"]: node for node in nodes}
    target_frame = packet["transitions"]["initialFrame"] - 1
    packing = packet["surface"]["statePacking"]
    position_dictionary = packing.get("positionDictionary")
    position_indices = (base64_integers(packing.get("positionIndicesBase64"), 2,
                                        int(packing["stateCount"]),
                                        "INVALID_SURFACE_STATE",
                                        "surface position indices")
                        if position_dictionary is not None else None)

    def coordinate(value: int) -> str:
        return "0" if value == 0 else f"{value}px"

    for index, target in enumerate(binding["targets"]["leaves"]):
        node = by_id[target]
        expected_visibility = ("visible"
                               if ((packed[index >> 3] >> (index & 7)) & 1) else "hidden")
        require(node.get("styles", {}).get("visibility") == expected_visibility,
                "SURFACE_TREE_MISMATCH",
                f"Surface leaf {index} initial visibility does not match TREE")
        face = packet["surface"]["faces"][index]
        source_frame = selected_frame = 0
        selected_state = 0
        for local in range(int(face["stateCount"])):
            source_frame += packing["sourceFrameDeltas"][int(face["stateOffset"]) + local]
            if source_frame > target_frame:
                break
            selected_frame = source_frame
            selected_state = local
        actual = node.get("styles", {}).get(
            "backgroundPosition" if position_dictionary is not None else "backgroundPositionY")
        if position_dictionary is not None and position_indices is not None:
            position = position_dictionary[
                position_indices[int(face["stateOffset"]) + selected_state]]
            matches = actual == " ".join(coordinate(int(value)) for value in position)
        elif selected_frame == 0:
            matches = actual is None or actual in ("0", "0px", "0%")
        else:
            matches = actual == f"{-selected_frame * face['leafHeight']}px"
        require(matches, "SURFACE_TREE_MISMATCH",
                f"Surface leaf {index} initial atlas position does not match TREE")


def validate_initial_variant_closure(document: dict[str, Any], nodes: list[dict]) -> None:
    state = next((channel for channel in document["state"]["channels"]
                  if channel["codec"] in ("polycss-variants-packed@0", "polycss-paged-variants@0")), None)
    binding = next((channel for channel in document["bindings"]["channels"]
                    if channel["interpreter"] in ("polycss-variants@0", "polycss-paged-variants@0")), None)
    if state is None or binding is None:
        return
    packet = state["data"]["packet"]
    initial = base64_integers(packet["initial"]["classIndicesBase64"], 2,
                              len(binding["targets"]["nodes"]),
                              "INVALID_VARIANT_STATE", "variant initial classes")
    by_id = {node["id"]: node for node in nodes}
    classes = packet["classes"]
    class_set = set(classes)
    for index, target in enumerate(binding["targets"]["nodes"]):
        active = [token for token in by_id[target].get("classes", []) if token in class_set]
        expected = [] if initial[index] == 0xffff else [classes[initial[index]]]
        require(active == expected, "VARIANT_TREE_MISMATCH",
                f"Variant node {index} initial class does not match TREE")


def validate_presentation_closure(document: dict[str, Any], nodes: list[dict],
                                  resources: dict[str, dict]) -> None:
    state = next((channel for channel in document["state"]["channels"]
                  if channel["codec"] == "static-presentation@0"), None)
    binding = next((channel for channel in document["bindings"]["channels"]
                    if channel["interpreter"] == "static-presentation@0"), None)
    if state is None or binding is None:
        return
    packet = state["data"]["packet"]
    mount = document["tree"]["mount"]
    mount_styles = mount.get("styles", {})
    background = packet.get("background")
    resource_style = mount.get("resourceStyles", {}).get("backgroundImage")
    if background is not None:
        resource = resources.get(background["resource"])
        require(resource is not None and resource["kind"] == "image",
                "RESOURCE_ROLE_MISMATCH",
                "Presentation background must reference an image")
        require(isinstance(resource_style, dict)
                and resource_style.get("resource") == background["resource"]
                and resource_style.get("syntax") == "overlay-url"
                and resource_style.get("overlayOpacity") == background["opacity"],
                "PRESENTATION_TREE_MISMATCH",
                "Presentation background resource does not match TREE mount")
        require(mount_styles.get("backgroundPosition") == background["position"]
                and mount_styles.get("backgroundRepeat") == background["repeat"]
                and mount_styles.get("backgroundSize") == background["size"],
                "PRESENTATION_TREE_MISMATCH",
                "Presentation background styles do not match TREE mount")
    else:
        require(resource_style is None
                and all(key not in mount_styles
                        for key in ("backgroundPosition", "backgroundRepeat", "backgroundSize")),
                "PRESENTATION_TREE_MISMATCH",
                "Presentation without a background cannot declare TREE mount background bindings")
    by_id = {node["id"]: node for node in nodes}
    camera_node = by_id.get(binding["targets"]["camera"])
    camera = packet["camera"]
    camera_styles = camera_node.get("styles", {}) if camera_node else {}
    require(camera_styles.get("perspective") == f"{css_number(camera['perspective'])}px"
            and camera_styles.get("perspectiveOrigin")
            == f"{css_number(camera['sourceWidth'] / 2)}px {css_number(camera['sourceHeight'] / 2)}px"
            and camera_styles.get("position") == "relative"
            and camera_styles.get("width") == f"{css_number(camera['sourceWidth'])}px"
            and camera_styles.get("height") == f"{css_number(camera['sourceHeight'])}px"
            and "transformOrigin" not in camera_styles
            and "transformStyle" not in camera_styles,
            "PRESENTATION_TREE_MISMATCH",
            "Presentation camera does not match TREE styles")
    playback = next((channel for channel in document["bindings"]["channels"]
                     if channel["interpreter"] in ("polycss-playback@0",
                                                    "polycss-paged-playback@0")), None)
    if playback is not None:
        require(playback["parameters"]["baseSceneTransform"] == camera["baseSceneTransform"],
                "PRESENTATION_TREE_MISMATCH", "Presentation transform does not match playback")
        if playback["interpreter"] == "polycss-playback@0":
            require(by_id.get(playback["targets"]["model"], {}).get("styles", {}).get("transform")
                    == camera["baseSceneTransform"], "PRESENTATION_TREE_MISMATCH",
                    "Presentation transform does not match playback TREE")
    interaction = next((channel for channel in document["bindings"]["channels"]
                        if channel["interpreter"] == "polycss-pointer-grab@0"), None)
    if interaction is not None:
        require("cursorLayer" in binding["targets"] and "cursorStates" in binding["targets"]
                and interaction["targets"]["cursorLayer"] == binding["targets"]["cursorLayer"]
                and interaction["targets"]["cursorStates"] == binding["targets"]["cursorStates"],
                "PRESENTATION_TREE_MISMATCH",
                "Presentation and interaction cursor targets differ")


def state_page_integers(value: Any, width: int, maximum_count: int, label: str) -> array:
    decoded_length = canonical_base64_decoded_length(value, label, "INVALID_STATE_PAGE")
    require(decoded_length % width == 0 and decoded_length // width <= maximum_count,
            "INVALID_STATE_PAGE", f"{label} is truncated or excessive")
    try:
        payload = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise DomError("INVALID_STATE_PAGE", f"{label} is not valid base64") from error
    require(len(payload) == decoded_length and base64.b64encode(payload).decode("ascii") == value,
            "INVALID_STATE_PAGE", f"{label} is not canonical base64")
    values = array({1: "B", 2: "H", 4: "I"}[width])
    require(values.itemsize == width, "INVALID_STATE_PAGE", f"{label} has unsupported host width")
    values.frombytes(payload)
    if sys.byteorder != "little" and width > 1:
        values.byteswap()
    return values


def state_page_bitset(value: Any, count: int, label: str) -> array:
    count = int(count)
    packed = state_page_integers(value, 1, math.ceil(count / 8), label)
    require(len(packed) == math.ceil(count / 8), "STATE_COLUMN_MISMATCH",
            f"{label} is truncated")
    if count % 8 and packed:
        require(packed[-1] >> (count % 8) == 0, "INVALID_STATE_PAGE",
                f"{label} has nonzero unused bits")
    output = array("B", [0]) * count
    for index in range(count):
        output[index] = (packed[index >> 3] >> (index & 7)) & 1
    return output


def state_page_matrix(value: str, label: str) -> str:
    require(isinstance(value, str) and value.startswith("matrix3d(") and value.endswith(")"),
            "INVALID_STATE_PAGE", f"{label} is not a matrix3d transform")
    tokens = value[9:-1].split(",")
    require(len(tokens) == 16, "INVALID_STATE_PAGE",
            f"{label} must contain sixteen matrix3d components")
    components = []
    for token in tokens:
        try:
            number = float(token)
        except ValueError as error:
            raise DomError("INVALID_STATE_PAGE", f"{label} contains a nonnumeric component") from error
        require(token and token == ecma_number(number), "INVALID_STATE_PAGE",
                f"{label} contains a noncanonical CSS number")
        component = f32(number)
        rounded = math.floor(component * 1_000_000 + 0.5) / 1_000_000
        require(math.isfinite(component) and token == ecma_number(0.0 if rounded == 0 else rounded),
                "INVALID_STATE_PAGE", f"{label} contains a noncanonical binary32 component")
        components.append(component)
    require(components[3] == components[7] == components[11] == 0 and components[15] == 1,
            "INVALID_STATE_PAGE", f"{label} is not an affine prepared matrix")
    require(value != "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)",
            "INVALID_STATE_PAGE", f"{label} must encode identity as null")
    return value


def validate_state_page_payload(document: dict[str, Any], record: dict,
                                decoded: bytes, limits: dict[str, int]) -> dict:
    owner = ("polycss-paged-variants@0" if record["codec"] == "polycss-paged-variants-page@0"
             else "polycss-paged-playback@0")
    state = next((channel for channel in document["state"]["channels"]
                  if channel["codec"] == owner), None)
    binding = next((channel for channel in document["bindings"]["channels"]
                    if channel["interpreter"] == owner), None)
    require(state is not None and binding is not None, "UNEXPECTED_STATE_PAGE",
            f"State page {record['id']} has no matching paged channel")
    packet = state["data"]["packet"]
    descriptor = next((entry for entry in packet["pages"] if entry["resource"] == record["id"]), None)
    require(descriptor is not None, "UNEXPECTED_STATE_PAGE",
            f"State page {record['id']} is not referenced by its matching channel")
    page = parse_canonical_json(decoded, f"state page {record['id']}")
    common = {"version", "codec", "channel", "startFrame", "endFrame"}
    fields = (common | {"keyframeClassIndicesBase64", "sequential"}
              if owner == "polycss-paged-variants@0"
              else common | {"transforms", "keyframe", "sequential"})
    page = strict_keys(page, fields, "INVALID_STATE_PAGE", f"state page {record['id']}")
    require(set(page) == fields and as_int(page.get("version"), "INVALID_STATE_PAGE",
            "state page version") == 0 and page.get("codec") == record["codec"]
            and page.get("channel") == state["id"], "INVALID_STATE_PAGE",
            f"State page {record['id']} identity or fields are invalid")
    start = int(as_int(page.get("startFrame"), "STATE_PAGE_COVERAGE_MISMATCH", "state page start", 1))
    end = int(as_int(page.get("endFrame"), "STATE_PAGE_COVERAGE_MISMATCH", "state page end", 1))
    require(start == descriptor["startFrame"] and end == descriptor["endFrame"],
            "STATE_PAGE_COVERAGE_MISMATCH", f"State page {record['id']} coverage differs")
    frame_count = end - start + 1
    require(0 < frame_count <= limits["state_page_frames"], "STATE_PAGE_COVERAGE_MISMATCH",
            f"State page {record['id']} coverage is invalid")
    if owner == "polycss-paged-variants@0":
        target_count = len(binding["targets"]["nodes"])
        keyframe = state_page_integers(page.get("keyframeClassIndicesBase64"), 2, target_count,
                                       "state page keyframe")
        require(len(keyframe) == target_count and all(value == 0xffff or value < len(packet["classes"])
                                                       for value in keyframe),
                "STATE_COLUMN_MISMATCH", f"State page {record['id']} keyframe is invalid")
        transitions = strict_keys(page.get("sequential"), {"offsetsBase64", "targetIndicesBase64",
                                  "classIndicesBase64"}, "INVALID_STATE_PAGE",
                                  "state page transitions")
        offsets = state_page_integers(transitions.get("offsetsBase64"), 4, frame_count + 1,
                                      "state page offsets")
        targets = state_page_integers(transitions.get("targetIndicesBase64"), 2,
                                      limits["prepared_changes"], "state page targets")
        classes = state_page_integers(transitions.get("classIndicesBase64"), 2,
                                      limits["prepared_changes"], "state page classes")
        require(len(offsets) == frame_count + 1 and offsets[0] == offsets[1] == 0
                and offsets[-1] == len(targets) == len(classes) == descriptor["changeCount"]
                and all(offsets[index - 1] <= value for index, value in enumerate(offsets) if index),
                "STATE_COLUMN_MISMATCH", f"State page {record['id']} columns are invalid")
        row = array("H", keyframe)
        for local_frame in range(1, frame_count):
            previous = -1
            for cursor in range(offsets[local_frame], offsets[local_frame + 1]):
                target, class_index = targets[cursor], classes[cursor]
                require(previous < target < target_count
                        and (class_index == 0xffff or class_index < len(packet["classes"]))
                        and row[target] != class_index, "INVALID_STATE_PAGE",
                        f"State page {record['id']} transition is invalid")
                row[target] = class_index; previous = target
        materialized = target_count * 2 + (frame_count + 1) * 4 + len(targets) * 4
        require(materialized == descriptor["materializedByteLength"],
                "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH",
                f"State page {record['id']} materialized size differs")
        return {"resource": record["id"], "codec": record["codec"], "channel": state["id"],
                "startFrame": start, "endFrame": end, "materializedByteLength": materialized,
                "keyframe": keyframe, "offsets": offsets, "targets": targets, "classes": classes}

    transforms_value = page.get("transforms")
    require(isinstance(transforms_value, list) and len(transforms_value) == descriptor["transformCount"]
            and 0 < len(transforms_value) <= limits["prepared_transforms"],
            "TRANSFORM_ALLOCATION_LIMIT", f"State page {record['id']} transforms are invalid")
    transforms: list[str] = []
    for index, value in enumerate(transforms_value):
        require(value is None or isinstance(value, str), "INVALID_STATE_PAGE",
                f"State page {record['id']} transform {index} is invalid")
        transforms.append("" if value is None else state_page_matrix(
            value, f"State page {record['id']} transform {index}"))
    key = strict_keys(page.get("keyframe"), {"appearance", "modelTransform",
                      "shapeTransformIndicesBase64", "shapeVisibilityBitsBase64",
                      "leafTransformIndicesBase64"}, "INVALID_STATE_PAGE", "state page keyframe")
    appearance = int(as_int(key.get("appearance"), "INVALID_STATE_PAGE", "keyframe appearance"))
    model = int(as_int(key.get("modelTransform"), "INVALID_STATE_PAGE", "keyframe model"))
    require(appearance < len(packet["appearances"]) and model < len(transforms),
            "INVALID_STATE_PAGE", f"State page {record['id']} keyframe is invalid")
    shape_key = state_page_integers(key.get("shapeTransformIndicesBase64"), 4,
                                    packet["shapeCount"], "keyframe shape transforms")
    visibility_key = state_page_bitset(key.get("shapeVisibilityBitsBase64"),
                                       packet["shapeCount"], "keyframe shape visibility")
    leaf_key = state_page_integers(key.get("leafTransformIndicesBase64"), 4,
                                   packet["leafCount"], "keyframe leaf transforms")
    require(len(shape_key) == packet["shapeCount"] and len(leaf_key) == packet["leafCount"]
            and all(value < len(transforms) for value in shape_key)
            and all(value < len(transforms) for value in leaf_key), "STATE_COLUMN_MISMATCH",
            f"State page {record['id']} keyframe columns are invalid")
    sequential_fields = {"appearanceIndicesBase64", "modelTransformIndicesBase64",
                         "shapeOffsetsBase64", "shapeTargetIndicesBase64",
                         "shapeTransformIndicesBase64", "shapeVisibilityBase64",
                         "leafOffsetsBase64", "leafTargetIndicesBase64",
                         "leafTransformIndicesBase64"}
    sequential = strict_keys(page.get("sequential"), sequential_fields,
                             "INVALID_STATE_PAGE", "state page sequential transitions")
    require(set(sequential) == sequential_fields, "INVALID_STATE_PAGE",
            "State page sequential fields are incomplete")
    appearances = state_page_integers(sequential.get("appearanceIndicesBase64"), 2,
                                      frame_count, "state page appearances")
    models = state_page_integers(sequential.get("modelTransformIndicesBase64"), 4,
                                 frame_count, "state page models")
    shape_offsets = state_page_integers(sequential.get("shapeOffsetsBase64"), 4,
                                        frame_count + 1, "state page shape offsets")
    shape_targets = state_page_integers(sequential.get("shapeTargetIndicesBase64"), 4,
                                        limits["prepared_changes"], "state page shape targets")
    shape_transforms = state_page_integers(sequential.get("shapeTransformIndicesBase64"), 4,
                                           limits["prepared_changes"], "state page shape transforms")
    shape_visibility = state_page_integers(sequential.get("shapeVisibilityBase64"), 1,
                                           limits["prepared_changes"], "state page shape visibility")
    leaf_offsets = state_page_integers(sequential.get("leafOffsetsBase64"), 4,
                                       frame_count + 1, "state page leaf offsets")
    leaf_targets = state_page_integers(sequential.get("leafTargetIndicesBase64"), 4,
                                       limits["prepared_changes"], "state page leaf targets")
    leaf_transforms = state_page_integers(sequential.get("leafTransformIndicesBase64"), 4,
                                          limits["prepared_changes"], "state page leaf transforms")
    require(len(appearances) == len(models) == frame_count and appearances[0] == appearance
            and all(value < len(packet["appearances"]) for value in appearances)
            and all(value == 0xffffffff or value < len(transforms) for value in models),
            "STATE_COLUMN_MISMATCH", f"State page {record['id']} dense columns are invalid")
    require(len(shape_offsets) == len(leaf_offsets) == frame_count + 1
            and shape_offsets[0] == leaf_offsets[0] == 0
            and shape_offsets[-1] == len(shape_targets) == len(shape_transforms) == len(shape_visibility)
            == descriptor["shapeChangeCount"]
            and leaf_offsets[-1] == len(leaf_targets) == len(leaf_transforms)
            == descriptor["leafChangeCount"]
            and all(shape_offsets[index - 1] <= value for index, value in enumerate(shape_offsets) if index)
            and all(leaf_offsets[index - 1] <= value for index, value in enumerate(leaf_offsets) if index),
            "STATE_COLUMN_MISMATCH", f"State page {record['id']} sparse columns are invalid")
    owners: dict[int, str] = {}
    values: dict[tuple[str, str], int] = {}
    next_first = 0

    def claim(index: int, owner_name: str, label: str) -> None:
        nonlocal next_first
        require(0 <= index < len(transforms), "INVALID_STATE_PAGE", f"{label} is missing")
        prior = owners.get(index)
        if prior is None:
            require(index == next_first, "TRANSFORM_GROUP_MISMATCH",
                    f"{label} violates canonical first-use order")
            owners[index] = owner_name; next_first += 1
        else:
            require(prior == owner_name, "TRANSFORM_GROUP_MISMATCH",
                    f"{label} aliases incompatible owners")
        value_key = (owner_name, transforms[index])
        require(value_key not in values or values[value_key] == index, "TRANSFORM_GROUP_MISMATCH",
                f"{label} duplicates an owner-domain transform")
        values[value_key] = index

    claim(model, "model", "keyframe model")
    for index, transform in enumerate(shape_key): claim(transform, "shape", f"keyframe shape {index}")
    for index, transform in enumerate(leaf_key): claim(transform, f"leaf:{index}", f"keyframe leaf {index}")
    current_model = model
    current_shapes, current_visibility, current_leaves = array("I", shape_key), array("B", visibility_key), array("I", leaf_key)
    for local in range(frame_count):
        changed_model = models[local]
        if changed_model != 0xffffffff:
            claim(changed_model, "model", f"frame {start + local} model")
            if local:
                require(changed_model != current_model, "INVALID_STATE_PAGE", "No-op model transition")
                current_model = changed_model
        previous = -1
        for cursor in range(shape_offsets[local], shape_offsets[local + 1]):
            target, transform, visible = shape_targets[cursor], shape_transforms[cursor], shape_visibility[cursor]
            require(previous < target < packet["shapeCount"] and visible <= 1,
                    "INVALID_STATE_PAGE", "Invalid shape transition")
            claim(transform, "shape", f"frame {start + local} shape {target}")
            if local:
                require(current_shapes[target] != transform or current_visibility[target] != visible,
                        "INVALID_STATE_PAGE", "No-op shape transition")
                current_shapes[target] = transform; current_visibility[target] = visible
            previous = target
        previous = -1
        for cursor in range(leaf_offsets[local], leaf_offsets[local + 1]):
            target, transform = leaf_targets[cursor], leaf_transforms[cursor]
            require(previous < target < packet["leafCount"], "INVALID_STATE_PAGE",
                    "Invalid leaf transition")
            claim(transform, f"leaf:{target}", f"frame {start + local} leaf {target}")
            if local:
                require(current_leaves[target] != transform, "INVALID_STATE_PAGE", "No-op leaf transition")
                current_leaves[target] = transform
            previous = target
    require(len(owners) == len(transforms), "TRANSFORM_GROUP_MISMATCH",
            f"State page {record['id']} has an unreferenced transform")
    transform_bytes = sum(8 + len(value) * 2 for value in transforms)
    materialized = (transform_bytes + len(shape_key) * 4 + len(visibility_key) + len(leaf_key) * 4
                    + len(appearances) * 2 + len(models) * 4 + len(shape_offsets) * 4
                    + len(shape_targets) * 4 + len(shape_transforms) * 4 + len(shape_visibility)
                    + len(leaf_offsets) * 4 + len(leaf_targets) * 4 + len(leaf_transforms) * 4)
    require(materialized == descriptor["materializedByteLength"],
            "STATE_PAGE_MATERIALIZED_SIZE_MISMATCH",
            f"State page {record['id']} materialized size differs")
    return {"resource": record["id"], "codec": record["codec"], "channel": state["id"],
            "startFrame": start, "endFrame": end, "materializedByteLength": materialized,
            "transforms": transforms,
            "keyframe": {"appearance": appearance, "modelTransform": model,
                         "shapeTransforms": shape_key, "shapeVisibility": visibility_key,
                         "leafTransforms": leaf_key}, "appearances": appearances,
            "modelTransforms": models, "shapeOffsets": shape_offsets,
            "shapeTargets": shape_targets, "shapeTransforms": shape_transforms,
            "shapeVisibility": shape_visibility, "leafOffsets": leaf_offsets,
            "leafTargets": leaf_targets, "leafTransforms": leaf_transforms}


def variant_page_row(page: dict, frame: int) -> array:
    row = array("H", page["keyframe"])
    for local in range(1, int(frame) - page["startFrame"] + 1):
        for cursor in range(page["offsets"][local], page["offsets"][local + 1]):
            row[page["targets"][cursor]] = page["classes"][cursor]
    return row


def playback_page_row(page: dict, local_frame: int) -> dict:
    local_frame = int(local_frame)
    key = page["keyframe"]
    appearance = key["appearance"]
    model = page["transforms"][key["modelTransform"]]
    shapes = [page["transforms"][index] for index in key["shapeTransforms"]]
    visibility = array("B", key["shapeVisibility"])
    leaves = [page["transforms"][index] for index in key["leafTransforms"]]
    for local in range(1, local_frame + 1):
        appearance = page["appearances"][local]
        if page["modelTransforms"][local] != 0xffffffff:
            model = page["transforms"][page["modelTransforms"][local]]
        for cursor in range(page["shapeOffsets"][local], page["shapeOffsets"][local + 1]):
            target = page["shapeTargets"][cursor]
            shapes[target] = page["transforms"][page["shapeTransforms"][cursor]]
            visibility[target] = page["shapeVisibility"][cursor]
        for cursor in range(page["leafOffsets"][local], page["leafOffsets"][local + 1]):
            target = page["leafTargets"][cursor]
            leaves[target] = page["transforms"][page["leafTransforms"][cursor]]
    return {"appearance": appearance, "modelTransform": model, "shapeTransforms": shapes,
            "shapeVisibility": visibility, "leafTransforms": leaves}


def validate_paged_playback_boundary(previous: dict, target: dict) -> None:
    source = playback_page_row(previous, previous["endFrame"] - previous["startFrame"])
    final = playback_page_row(target, 0)
    require(target["appearances"][0] == final["appearance"], "STATE_PAGE_BOUNDARY_MISMATCH",
            "Paged playback boundary appearance differs from keyframe")
    expected_model = 0xffffffff if source["modelTransform"] == final["modelTransform"] else target["keyframe"]["modelTransform"]
    require(target["modelTransforms"][0] == expected_model, "STATE_PAGE_BOUNDARY_MISMATCH",
            "Paged playback boundary model delta is incomplete or excessive")
    expected_shapes = [index for index in range(len(final["shapeTransforms"]))
                       if source["shapeTransforms"][index] != final["shapeTransforms"][index]
                       or source["shapeVisibility"][index] != final["shapeVisibility"][index]]
    actual_shapes = list(target["shapeTargets"][target["shapeOffsets"][0]:target["shapeOffsets"][1]])
    require(actual_shapes == expected_shapes, "STATE_PAGE_BOUNDARY_MISMATCH",
            "Paged playback boundary shape targets are incomplete or excessive")
    for cursor in range(target["shapeOffsets"][0], target["shapeOffsets"][1]):
        shape = target["shapeTargets"][cursor]
        require(target["transforms"][target["shapeTransforms"][cursor]] == final["shapeTransforms"][shape]
                and target["shapeVisibility"][cursor] == final["shapeVisibility"][shape],
                "STATE_PAGE_BOUNDARY_MISMATCH", "Paged playback boundary shape differs")
    expected_leaves = [index for index in range(len(final["leafTransforms"]))
                       if source["leafTransforms"][index] != final["leafTransforms"][index]]
    actual_leaves = list(target["leafTargets"][target["leafOffsets"][0]:target["leafOffsets"][1]])
    require(actual_leaves == expected_leaves, "STATE_PAGE_BOUNDARY_MISMATCH",
            "Paged playback boundary leaf targets are incomplete or excessive")
    for cursor in range(target["leafOffsets"][0], target["leafOffsets"][1]):
        leaf = target["leafTargets"][cursor]
        require(target["transforms"][target["leafTransforms"][cursor]] == final["leafTransforms"][leaf],
                "STATE_PAGE_BOUNDARY_MISMATCH", "Paged playback boundary leaf differs")


def validate_decoded_state_page_closure(document: dict[str, Any], decoded_pages: dict[str, dict]) -> None:
    nodes = {node["id"]: node for node in document["tree"]["nodes"]}
    variant_state = next((channel for channel in document["state"]["channels"]
                          if channel["codec"] == "polycss-paged-variants@0"), None)
    if variant_state is not None:
        packet = variant_state["data"]["packet"]
        descriptor = next(page for page in packet["pages"]
                          if page["startFrame"] <= packet["initial"]["frame"] <= page["endFrame"])
        page = decoded_pages.get(descriptor["resource"])
        if page is not None:
            binding = next(channel for channel in document["bindings"]["channels"]
                           if channel["interpreter"] == "polycss-paged-variants@0")
            expected = state_page_integers(packet["initial"]["classIndicesBase64"], 2,
                                           len(binding["targets"]["nodes"]), "variant initial row")
            require(variant_page_row(page, packet["initial"]["frame"]) == expected,
                    "STATE_PAGE_INITIAL_MISMATCH", "Paged variant initial page differs from shell")
    playback_state = next((channel for channel in document["state"]["channels"]
                           if channel["codec"] == "polycss-paged-playback@0"), None)
    if playback_state is None:
        return
    packet = playback_state["data"]["packet"]
    pages = [decoded_pages.get(descriptor["resource"]) for descriptor in packet["pages"]]
    if all(page is not None for page in pages):
        for index, page in enumerate(pages):
            validate_paged_playback_boundary(pages[index - 1], page)
    descriptor = next(page for page in packet["pages"]
                      if page["startFrame"] <= packet["initial"]["sourceFrame"] <= page["endFrame"])
    page = decoded_pages.get(descriptor["resource"])
    if page is None:
        return
    initial = playback_page_row(page, packet["initial"]["sourceFrame"] - page["startFrame"])
    require(initial["appearance"] == packet["initial"]["appearance"],
            "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial appearance differs from shell")
    binding = next(channel for channel in document["bindings"]["channels"]
                   if channel["interpreter"] == "polycss-paged-playback@0")
    expected_model = (binding["parameters"]["baseSceneTransform"] if not initial["modelTransform"]
                      else f"{binding['parameters']['baseSceneTransform']} {initial['modelTransform']}")
    require(nodes[binding["targets"]["model"]].get("styles", {}).get("transform") == expected_model,
            "STATE_PAGE_INITIAL_MISMATCH", "Paged playback initial model differs from TREE")
    for index, target in enumerate(binding["targets"]["shapes"]):
        styles = nodes[target].get("styles", {})
        require(styles.get("transform") == initial["shapeTransforms"][index]
                and styles.get("visibility") == ("visible" if initial["shapeVisibility"][index] else "hidden"),
                "STATE_PAGE_INITIAL_MISMATCH", f"Paged playback initial shape {index} differs from TREE")
    for index, target in enumerate(binding["targets"]["leaves"]):
        require(nodes[target].get("styles", {}).get("transform") == initial["leafTransforms"][index],
                "STATE_PAGE_INITIAL_MISMATCH", f"Paged playback initial leaf {index} differs from TREE")


CSS_WHITESPACE = "\t\n\f\r "
SAFE_CSS_FUNCTIONS = frozenset("""
abs acos asin atan atan2 blur brightness calc circle clamp color color-mix
conic-gradient contrast cos cubic-bezier drop-shadow ellipse exp
fit-content grayscale hsl hsla hwb hypot hue-rotate inset invert is lab lch
light-dark linear-gradient log matrix matrix3d max min minmax mod not nth-child
nth-last-child nth-last-of-type nth-of-type oklab oklch opacity path perspective
polygon pow radial-gradient rem repeat repeating-conic-gradient
repeating-linear-gradient repeating-radial-gradient rgb rgba rotate rotate3d
rotatex rotatey rotatez round saturate scale scale3d scalex scaley scalez sepia
sign sin skew skewx skewy sqrt steps tan translate translate3d translatex
translatey translatez url where
""".split())
SAFE_CSS_PROPERTIES = frozenset("""
-webkit-backface-visibility backface-visibility background background-clip
background-color background-image background-position-x background-position-y
background-repeat background-size border border-bottom-left-radius
border-bottom-right-radius border-color border-shape border-top-left-radius
border-top-right-radius box-sizing color contain corner-bottom-left-shape
corner-bottom-right-shape corner-top-left-shape corner-top-right-shape cursor display font font-style font-weight height
image-rendering inset isolation left line-height margin max-width object-fit
object-position opacity overflow padding pointer-events position text-decoration
top touch-action transform transform-origin transform-style user-select
visibility width will-change z-index
""".split())


def trim_css_range(css: str, start: int, end: int) -> tuple[int, int]:
    while start < end and css[start] in CSS_WHITESPACE:
        start += 1
    while end > start and css[end - 1] in CSS_WHITESPACE:
        end -= 1
    return start, end


def split_css_top_level(css: str, start: int, end: int, delimiter: str,
                        code: str, label: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    item_start, quote, round_depth, square_depth = start, "", 0, 0
    for index in range(start, end):
        ch = css[index]
        if quote:
            require(ch not in "\n\r\f", code, f"{label} contains a newline in a string")
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "(":
            round_depth += 1
        elif ch == ")":
            round_depth -= 1
        elif ch == "[":
            square_depth += 1
        elif ch == "]":
            square_depth -= 1
        elif ch == delimiter and round_depth == square_depth == 0:
            ranges.append(trim_css_range(css, item_start, index))
            item_start = index + 1
        require(round_depth >= 0 and square_depth >= 0, code,
                f"{label} delimiters are unbalanced")
    require(not quote and round_depth == square_depth == 0, code,
            f"{label} is unterminated")
    ranges.append(trim_css_range(css, item_start, end))
    return ranges


def css_top_level_colon(css: str, start: int, end: int) -> int:
    quote, round_depth, square_depth = "", 0, 0
    for index in range(start, end):
        ch = css[index]
        if quote:
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'": quote = ch
        elif ch == "(": round_depth += 1
        elif ch == ")": round_depth -= 1
        elif ch == "[": square_depth += 1
        elif ch == "]": square_depth -= 1
        elif ch == ":" and round_depth == square_depth == 0: return index
    return -1


def parse_css_rules(css: str, limits: dict[str, int]) -> list[tuple[int, int, int, int]]:
    rules: list[tuple[int, int, int, int]] = []
    index = 0
    while index < len(css):
        while index < len(css) and css[index] in CSS_WHITESPACE:
            index += 1
        if index == len(css):
            break
        prelude_start, quote, round_depth, square_depth, opening = index, "", 0, 0, -1
        while index < len(css):
            ch = css[index]
            if quote:
                require(ch not in "\n\r\f", "MALFORMED_CSS", "Selector string contains a newline")
                if ch == quote: quote = ""
            elif ch in "\"'": quote = ch
            elif ch == "(": round_depth += 1
            elif ch == ")": round_depth -= 1
            elif ch == "[": square_depth += 1
            elif ch == "]": square_depth -= 1
            elif ch == "{" and round_depth == square_depth == 0:
                opening = index
                break
            elif ch in "};" and round_depth == square_depth == 0:
                raise DomError("MALFORMED_CSS", "Stylesheet has text outside a qualified rule")
            require(round_depth >= 0 and square_depth >= 0, "MALFORMED_CSS",
                    "Selector delimiters are unbalanced")
            index += 1
        require(opening >= 0 and not quote and round_depth == square_depth == 0,
                "MALFORMED_CSS", "Stylesheet selector is unterminated")
        prelude = trim_css_range(css, prelude_start, opening)
        require(prelude[0] < prelude[1], "MALFORMED_CSS", "Stylesheet selector is empty")
        body_start, index = opening + 1, opening + 1
        quote, round_depth, square_depth, closing = "", 0, 0, -1
        while index < len(css):
            ch = css[index]
            if quote:
                require(ch not in "\n\r\f", "MALFORMED_CSS", "Declaration string contains a newline")
                if ch == quote: quote = ""
            elif ch in "\"'": quote = ch
            elif ch == "(": round_depth += 1
            elif ch == ")": round_depth -= 1
            elif ch == "[": square_depth += 1
            elif ch == "]": square_depth -= 1
            elif ch == "{":
                raise DomError("UNSAFE_CSS_NESTING", "Nested CSS rules are forbidden")
            elif ch == "}" and round_depth == square_depth == 0:
                closing = index
                break
            require(round_depth >= 0 and square_depth >= 0, "MALFORMED_CSS",
                    "Declaration delimiters are unbalanced")
            index += 1
        require(closing >= 0 and not quote and round_depth == square_depth == 0,
                "MALFORMED_CSS", "Stylesheet declaration block is unterminated")
        rules.append((prelude[0], prelude[1], body_start, closing))
        require(len(rules) <= limits["css_rules"], "CSS_RULE_LIMIT", "Stylesheet has too many rules")
        index = closing + 1
    require(bool(rules), "MALFORMED_CSS", "Stylesheet must contain a qualified rule")
    return rules


def assert_scoped_selector(selector: str, scope: str) -> None:
    require(selector.startswith(scope), "CSS_SCOPE_ESCAPE", "Stylesheet selector escapes its scope")
    remainder = selector[len(scope):]
    if not remainder:
        return
    require(remainder[0] in CSS_WHITESPACE + ">+~.#[:|", "MALFORMED_CSS_SELECTOR",
            "Scoped selector has an invalid initial compound")
    quote, round_depth, square_depth, index = "", 0, 0, 0
    while index < len(remainder):
        ch = remainder[index]
        if quote:
            if ch == quote: quote = ""
            index += 1; continue
        if ch in "\"'": quote = ch
        elif ch == "(": round_depth += 1
        elif ch == ")": round_depth -= 1
        elif ch == "[": square_depth += 1
        elif ch == "]": square_depth -= 1
        if round_depth or square_depth:
            index += 1; continue
        require(ch not in "+~" and not (ch == "|" and index + 1 < len(remainder) and remainder[index + 1] == "|"),
                "CSS_SCOPE_ESCAPE", "Stylesheet selector can select a sibling outside its scope")
        if ch == ">":
            return
        if ch in CSS_WHITESPACE:
            while index + 1 < len(remainder) and remainder[index + 1] in CSS_WHITESPACE:
                index += 1
            following = remainder[index + 1:index + 3]
            require(not following.startswith(("+", "~", "||")), "CSS_SCOPE_ESCAPE",
                    "Stylesheet selector can select a sibling outside its scope")
            return
        index += 1


def matching_css_paren(css: str, opening: int, end: int) -> int:
    quote, depth = "", 1
    for index in range(opening + 1, end):
        ch = css[index]
        if quote:
            if ch == quote: quote = ""
            continue
        if ch in "\"'": quote = ch
        elif ch == "(": depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0: return index
    raise DomError("MALFORMED_CSS", "Stylesheet function is unterminated")


def css_url_token(css: str, opening: int, closing: int) -> str:
    start, end = trim_css_range(css, opening + 1, closing)
    require(start < end, "UNBOUND_CSS_URL", "Stylesheet URL is empty")
    quote = css[start]
    if quote in "\"'":
        require(end - start >= 2 and css[end - 1] == quote, "MALFORMED_CSS",
                "Stylesheet URL string is unterminated")
        token = css[start + 1:end - 1]
    else:
        token = css[start:end]
        require(re.search(r"[\s\"'()]", token) is None, "MALFORMED_CSS",
                "Stylesheet URL token is malformed")
    scheme = re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", token)
    require(scheme is None or token.startswith("dom-asset:"), "UNSAFE_CSS",
            "Stylesheet URL may perform an external request")
    require(re.fullmatch(r"dom-asset:[a-z][a-z0-9._-]{0,63}", token) is not None,
            "UNBOUND_CSS_URL", f"Stylesheet URL {token} is not a logical asset token")
    return token


def scan_css_functions(css: str, start: int, end: int,
                       counters: dict[str, Any], limits: dict[str, int]) -> None:
    index, quote = start, ""
    while index < end:
        ch = css[index]
        if quote:
            if ch == quote: quote = ""
            index += 1; continue
        if ch in "\"'":
            quote = ch; index += 1; continue
        if re.match(r"[A-Za-z_-]", ch) is None:
            index += 1; continue
        cursor = index + 1
        while cursor < end and re.match(r"[A-Za-z0-9_-]", css[cursor]):
            cursor += 1
        open_paren = cursor
        while open_paren < end and css[open_paren] in CSS_WHITESPACE:
            open_paren += 1
        if open_paren >= end or css[open_paren] != "(":
            index = cursor; continue
        require(open_paren == cursor, "UNSAFE_CSS",
                "Stylesheet function names must immediately precede '('")
        name = css[index:cursor].lower()
        require(name in SAFE_CSS_FUNCTIONS, "UNSAFE_CSS_FUNCTION",
                f"Stylesheet function {name}() is forbidden")
        counters["functions"] += 1
        require(counters["functions"] <= limits["css_functions"], "CSS_FUNCTION_LIMIT",
                "Stylesheet has too many functions")
        if name == "url":
            closing = matching_css_paren(css, open_paren, end)
            counters["urls"].append(css_url_token(css, open_paren, closing))
            index = closing + 1
        else:
            index = open_paren + 1


def validate_css(payload: bytes, binding: dict, resources: dict[str, dict], limits: dict[str, int],
                 forbidden_class_tokens: set[str] | None = None) -> None:
    require(len(payload) <= limits["css"], "CSS_SIZE_LIMIT", "CSS is too large")
    try:
        css = payload.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise DomError("MALFORMED_UTF8", f"Stylesheet is not UTF-8: {error}") from error
    require(not css.startswith("\ufeff"), "MALFORMED_UTF8",
            f"Stylesheet {binding['id']} begins with a byte-order mark")
    require("\\" not in css, "UNSAFE_CSS_ESCAPE", "Stylesheet escapes are forbidden")
    require("/*" not in css and "*/" not in css, "UNSAFE_CSS_COMMENT", "Stylesheet comments are forbidden")
    require("@" not in css and "<!--" not in css and "-->" not in css,
            "UNSAFE_CSS", "Stylesheet at-rules and CDO/CDC tokens are forbidden")
    require("!" not in css, "UNSAFE_CSS_IMPORTANT",
            "Stylesheet priority annotations are forbidden")
    require(all(ord(ch) >= 0x20 or ch in "\t\n\f\r" for ch in css),
            "UNSAFE_CSS_CONTROL", "Stylesheet contains a forbidden control")
    counters: dict[str, Any] = {"functions": 0, "urls": [], "selectors": 0, "declarations": 0}
    scope = binding["scope"]
    for prelude_start, prelude_end, body_start, body_end in parse_css_rules(css, limits):
        for start, end in split_css_top_level(css, prelude_start, prelude_end, ",",
                                              "MALFORMED_CSS_SELECTOR", "Stylesheet selector list"):
            require(start < end, "MALFORMED_CSS_SELECTOR", "Stylesheet selector is empty")
            require(len(css[start:end].encode("utf-8")) <= limits["css_selector_bytes"],
                    "CSS_SELECTOR_LIMIT", "Stylesheet selector is too long")
            selector = css[start:end]
            assert_scoped_selector(selector, scope)
            for token in forbidden_class_tokens or set():
                for match in re.finditer(re.escape(token), selector):
                    before = selector[match.start() - 1] if match.start() > 0 else ""
                    after = selector[match.end()] if match.end() < len(selector) else ""
                    require((before and re.fullmatch(r"[A-Za-z0-9_-]", before))
                            or (after and re.fullmatch(r"[A-Za-z0-9_-]", after)),
                            "UNDECLARED_VARIANT_EFFECT",
                            f"Stylesheet selector mentions prepared variant token {token}")
            counters["selectors"] += 1
            require(counters["selectors"] <= limits["css_selectors"], "CSS_SELECTOR_LIMIT",
                    "Stylesheet has too many selectors")
            scan_css_functions(css, start, end, counters, limits)
        for start, end in split_css_top_level(css, body_start, body_end, ";",
                                              "MALFORMED_CSS", "Stylesheet declaration list"):
            if start == end:
                continue
            colon = css_top_level_colon(css, start, end)
            require(colon > start, "MALFORMED_CSS", "Stylesheet declaration lacks a colon")
            property_start, property_end = trim_css_range(css, start, colon)
            value_start, value_end = trim_css_range(css, colon + 1, end)
            property_name = css[property_start:property_end]
            require(re.fullmatch(r"-?[A-Za-z][A-Za-z0-9-]*", property_name) is not None
                    and not property_name.startswith("--"), "UNSAFE_CSS_PROPERTY",
                    f"Stylesheet property {property_name} is invalid")
            require(property_name.lower() in SAFE_CSS_PROPERTIES, "UNSAFE_CSS_PROPERTY",
                    f"Stylesheet property {property_name} is forbidden or outside polycss-3d@0")
            require(value_start < value_end, "MALFORMED_CSS", "Stylesheet declaration value is empty")
            counters["declarations"] += 1
            require(counters["declarations"] <= limits["css_declarations"], "CSS_DECLARATION_LIMIT",
                    "Stylesheet has too many declarations")
            scan_css_functions(css, value_start, value_end, counters, limits)
    token_map = {entry["token"]: entry["resource"] for entry in binding["assetTokens"]}
    seen = set(counters["urls"])
    require(all(token in token_map for token in counters["urls"]), "UNBOUND_CSS_URL",
            "Stylesheet uses an undeclared logical asset token")
    require(seen == set(token_map), "UNUSED_CSS_TOKEN", "CSS token declarations and use differ")
    require(all(rid in resources and resources[rid]["kind"] == "image" for rid in token_map.values()),
            "MISSING_CSS_ASSET", "CSS asset role is invalid")


def image_dimensions(payload: bytes, media: str) -> tuple[int, int]:
    if media == "image/png":
        signature = b"\x89PNG\r\n\x1a\n"
        require(len(payload) >= 45 and payload.startswith(signature),
                "IMAGE_MEDIA_MISMATCH", "PNG signature invalid or truncated")
        offset, dimensions, palette, image_data, image_data_ended, ended = 8, None, False, False, False, False
        color_type = None
        valid_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
        while offset < len(payload):
            require(offset + 12 <= len(payload), "IMAGE_MEDIA_MISMATCH", "PNG chunk header truncated")
            length = int.from_bytes(payload[offset:offset + 4], "big")
            chunk_type = payload[offset + 4:offset + 8]
            start, end = offset + 8, offset + 8 + length
            require(end + 4 <= len(payload), "IMAGE_MEDIA_MISMATCH", "PNG chunk exceeds resource bytes")
            expected_crc = int.from_bytes(payload[end:end + 4], "big")
            require((binascii.crc32(payload[offset + 4:end]) & 0xFFFFFFFF) == expected_crc,
                    "IMAGE_MEDIA_MISMATCH", "PNG chunk CRC invalid")
            if dimensions is None:
                require(chunk_type == b"IHDR" and length == 13,
                        "IMAGE_MEDIA_MISMATCH", "PNG IHDR must be first and exactly 13 bytes")
                width, height = int.from_bytes(payload[start:start + 4], "big"), int.from_bytes(payload[start + 4:start + 8], "big")
                bit_depth, color_type = payload[start + 8], payload[start + 9]
                require(width > 0 and height > 0 and bit_depth in valid_depths.get(color_type, set()),
                        "IMAGE_MEDIA_MISMATCH", "PNG IHDR dimensions, color, or depth invalid")
                require(payload[start + 10] == 0 and payload[start + 11] == 0 and payload[start + 12] in (0, 1),
                        "IMAGE_MEDIA_MISMATCH", "PNG IHDR methods unsupported")
                dimensions = (width, height)
            elif chunk_type == b"IHDR":
                raise DomError("IMAGE_MEDIA_MISMATCH", "PNG contains duplicate IHDR")
            elif chunk_type == b"PLTE":
                require(not palette and not image_data and length > 0 and length % 3 == 0 and length <= 768,
                        "IMAGE_MEDIA_MISMATCH", "PNG palette invalid or out of order")
                palette = True
            elif chunk_type == b"IDAT":
                require(not image_data_ended and length > 0,
                        "IMAGE_MEDIA_MISMATCH", "PNG image-data chunks must be nonempty and consecutive")
                image_data = True
            elif chunk_type == b"IEND":
                require(length == 0 and image_data and end + 4 == len(payload),
                        "IMAGE_MEDIA_MISMATCH", "PNG IEND invalid or followed by trailing bytes")
                ended = True
            elif chunk_type in (b"acTL", b"fcTL", b"fdAT"):
                raise DomError("IMAGE_ANIMATION_UNSUPPORTED",
                               "Animated PNG resources are outside polycss-3d@0")
            else:
                if image_data:
                    image_data_ended = True
                require(not (0x41 <= chunk_type[0] <= 0x5A),
                        "IMAGE_MEDIA_MISMATCH", "PNG contains an unsupported critical chunk")
            offset = end + 4
            if ended:
                break
        require(ended and image_data and (color_type != 3 or palette),
                "IMAGE_MEDIA_MISMATCH", "PNG is missing image, palette, or end chunks")
        return dimensions

    require(media == "image/webp" and len(payload) >= 26 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP",
            "IMAGE_MEDIA_MISMATCH", "WebP header invalid or truncated")
    require(int.from_bytes(payload[4:8], "little") + 8 == len(payload), "IMAGE_MEDIA_MISMATCH", "WebP RIFF size invalid")
    offset, extended, primary = 12, None, None
    allowed_auxiliary = {b"ALPH", b"ICCP", b"EXIF", b"XMP "}
    while offset < len(payload):
        require(offset + 8 <= len(payload), "IMAGE_MEDIA_MISMATCH", "WebP chunk header truncated")
        kind = payload[offset:offset + 4]
        length = int.from_bytes(payload[offset + 4:offset + 8], "little")
        start, end = offset + 8, offset + 8 + length
        require(end + (length & 1) <= len(payload), "IMAGE_MEDIA_MISMATCH", "WebP chunk exceeds RIFF bytes")
        if length & 1:
            require(payload[end] == 0, "IMAGE_MEDIA_MISMATCH", "WebP padding byte must be zero")
        if kind == b"VP8X":
            require(offset == 12 and length == 10 and extended is None and primary is None,
                    "IMAGE_MEDIA_MISMATCH", "WebP VP8X is malformed or misplaced")
            flags = payload[start]
            require(flags & 0x02 == 0, "IMAGE_ANIMATION_UNSUPPORTED",
                    "Animated WebP resources are outside polycss-3d@0")
            require(flags & 0xC1 == 0 and payload[start + 1:start + 4] == b"\0\0\0",
                    "IMAGE_MEDIA_MISMATCH", "WebP VP8X reserved bits are nonzero")
            extended = (int.from_bytes(payload[start + 4:start + 7], "little") + 1,
                        int.from_bytes(payload[start + 7:start + 10], "little") + 1)
        elif kind == b"VP8L":
            require(primary is None and length >= 6 and payload[start] == 0x2F,
                    "IMAGE_MEDIA_MISMATCH", "WebP VP8L duplicated or malformed")
            bits = int.from_bytes(payload[start + 1:start + 5], "little")
            require(bits >> 29 == 0, "IMAGE_MEDIA_MISMATCH", "WebP VP8L version unsupported")
            primary = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        elif kind == b"VP8 ":
            require(primary is None and length >= 11, "IMAGE_MEDIA_MISMATCH", "WebP VP8 duplicated or truncated")
            frame_tag = int.from_bytes(payload[start:start + 3], "little")
            partition = frame_tag >> 5
            require(frame_tag & 1 == 0 and frame_tag & 0x10 and partition > 0 and 10 + partition <= length,
                    "IMAGE_MEDIA_MISMATCH", "WebP VP8 frame tag invalid")
            require(payload[start + 3:start + 6] == b"\x9d\x01\x2a", "IMAGE_MEDIA_MISMATCH", "WebP VP8 key-frame header invalid")
            primary = (int.from_bytes(payload[start + 6:start + 8], "little") & 0x3FFF,
                       int.from_bytes(payload[start + 8:start + 10], "little") & 0x3FFF)
            require(primary[0] > 0 and primary[1] > 0, "IMAGE_MEDIA_MISMATCH", "WebP VP8 dimensions invalid")
        else:
            require(kind in allowed_auxiliary and extended is not None,
                    "IMAGE_MEDIA_MISMATCH", "WebP chunk unsupported or lacks VP8X")
        offset = end + (length & 1)
    require(offset == len(payload) and primary is not None,
            "IMAGE_MEDIA_MISMATCH", "WebP has no complete primary image bitstream")
    require(extended is None or extended == primary,
            "IMAGE_MEDIA_MISMATCH", "WebP VP8X and primary dimensions disagree")
    return extended or primary


def read_capped_file(path: Path, maximum: int, label: str,
                     expected: int | None = None, no_follow: bool = False) -> tuple[bytearray, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if no_follow:
        flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        require(stat_module.S_ISREG(metadata.st_mode), "UNSAFE_FILE_TYPE",
                f"{label} is not a regular file")
        require(metadata.st_size >= 0, "FILE_LIMIT", f"{label} has an invalid size")
        if expected is not None:
            require(metadata.st_size == expected, "RESOURCE_SIZE_MISMATCH",
                    f"{label} size does not match its package record")
        require(metadata.st_size <= maximum, "FILE_LIMIT",
                f"{label} exceeds its byte limit")
        output = bytearray(metadata.st_size)
        view = memoryview(output)
        offset = 0
        with os.fdopen(os.dup(descriptor), "rb", buffering=0) as stream:
            while offset < metadata.st_size:
                count = stream.readinto(view[offset:])
                require(count > 0, "FILE_CHANGED_DURING_READ",
                        f"{label} changed while it was read")
                offset += count
            require(not stream.read(1), "FILE_CHANGED_DURING_READ",
                    f"{label} grew while it was read")
        final_metadata = os.fstat(descriptor)
        require((final_metadata.st_dev, final_metadata.st_ino, final_metadata.st_size,
                 final_metadata.st_mtime_ns, final_metadata.st_ctime_ns)
                == (metadata.st_dev, metadata.st_ino, metadata.st_size,
                    metadata.st_mtime_ns, metadata.st_ctime_ns),
                "FILE_CHANGED_DURING_READ", f"{label} metadata changed while it was read")
        return output, metadata
    finally:
        os.close(descriptor)


def read_dom(path: Path, require_resources: bool = True) -> dict[str, Any]:
    limits = dict(DEFAULT_LIMITS)
    data, _ = read_capped_file(path, limits["file"], "domformat package")
    encoding, json_bytes = parse_transport(bytes(data), limits)
    document = strict_keys(
        parse_json(json_bytes, "domformat JSON document"),
        set(DOCUMENT_FIELDS),
        "INVALID_DOCUMENT", "Decoded document",
    )
    document = {name: document.get(name) for name in DOCUMENT_FIELDS}
    validate_meta(document["meta"])
    records, resource_map = validate_resources(document["resources"], limits)
    nodes, node_ids = validate_tree(document["tree"], resource_map, limits)
    cssb = strict_keys(document["cssBinding"], {"version", "stylesheets"}, "INVALID_CSS_BINDING", "CSSB")
    require(as_int(cssb.get("version"), "UNSUPPORTED_CSS_BINDING_SCHEMA", "CSSB version") == 0,
            "UNSUPPORTED_CSS_BINDING_SCHEMA", "CSSB version must be zero")
    stylesheets = cssb.get("stylesheets")
    require(isinstance(stylesheets, list) and stylesheets, "INVALID_CSS_BINDING", "CSSB stylesheets invalid")
    css_ids = set()
    for binding in stylesheets:
        binding = strict_keys(binding, {"id", "resource", "scope", "assetTokens"}, "INVALID_CSS_BINDING", "stylesheet binding")
        bid, rid = resource_id(binding.get("id"), "stylesheet id"), resource_id(binding.get("resource"), "stylesheet resource")
        require(bid not in css_ids and rid in resource_map and resource_map[rid]["kind"] == "stylesheet",
                "MISSING_CSS_RESOURCE", "Stylesheet binding is invalid")
        css_ids.add(bid)
        scope_match = (re.fullmatch(r'\[data-([a-z0-9-]{1,64})="([A-Za-z0-9._-]{1,64})"\]', binding.get("scope"))
                       if isinstance(binding.get("scope"), str) else None)
        require(scope_match is not None,
                "INVALID_CSS_SCOPE", "Stylesheet scope invalid")
        require([f"data-{scope_match.group(1)}", scope_match.group(2)] in document["tree"]["mount"]["attributes"],
                "CSS_SCOPE_MISMATCH", "Stylesheet scope is not an exact TREE mount attribute")
        tokens = binding.get("assetTokens")
        require(isinstance(tokens, list) and len(tokens) <= limits["css_asset_tokens"],
                "CSS_TOKEN_LIMIT", "Stylesheet tokens invalid or excessive")
        token_names = set()
        for entry in tokens:
            entry = strict_keys(entry, {"token", "resource"}, "INVALID_CSS_BINDING", "asset token")
            require(isinstance(entry.get("token"), str) and re.fullmatch(r"dom-asset:[a-z][a-z0-9._-]{0,63}", entry["token"])
                    and entry["token"] not in token_names, "INVALID_CSS_TOKEN", "CSS token invalid")
            require(entry.get("resource") in resource_map and resource_map[entry["resource"]]["kind"] == "image",
                    "MISSING_CSS_ASSET", "CSS token image resource invalid")
            token_names.add(entry["token"])
    state_channels, binding_channels = validate_state_bindings(document["state"], document["bindings"], node_ids, limits, nodes)
    validate_initial_surface_closure(document, nodes)
    validate_initial_variant_closure(document, nodes)
    validate_presentation_closure(document, nodes, resource_map)
    interpreters = {channel["interpreter"] for channel in binding_channels}
    expected_capabilities = list(BASE_REQUIRED_CAPABILITIES)
    included_paged_state = False
    for interpreter, capability in CAPABILITY_INTERPRETER_ORDER:
        if interpreter not in interpreters:
            continue
        if interpreter in ("polycss-paged-playback@0", "polycss-paged-variants@0") \
                and not included_paged_state:
            expected_capabilities.append("prepared-paged-state")
            included_paged_state = True
        expected_capabilities.append(capability)
    require(document["meta"]["capabilities"] == expected_capabilities,
            "CAPABILITY_CLOSURE_MISMATCH", "META required capabilities do not match executable interpreters")
    expected_conformance = ["retained-tree"]
    expected_conformance.extend(role for interpreter, role in CONFORMANCE_INTERPRETER_ORDER
                                if interpreter in interpreters)
    require(document["meta"]["conformance"]["executable"] == expected_conformance
            and document["meta"]["conformance"]["declaredOnly"] == [],
            "CONFORMANCE_CLOSURE_MISMATCH", "META conformance does not match executable interpreters")
    if document["meta"].get("initialExperience") == "interaction":
        require("prepared-pointer-grab-interaction" in document["meta"]["capabilities"],
                "MISSING_INITIAL_EXPERIENCE", "Interaction initial experience lacks its capability")
        interaction = next((channel for channel in binding_channels
                            if channel["interpreter"] == "polycss-pointer-grab@0"), None)
        require(interaction is not None and interaction["status"] == "executable",
                "MISSING_INITIAL_EXPERIENCE", "Interaction initial experience lacks an executable binding")
    counts = document["meta"].get("counts")
    if counts is not None:
        if "nodes" in counts:
            require(as_int(counts["nodes"], "META_COUNT_MISMATCH", "META node count") == len(nodes),
                    "META_COUNT_MISMATCH", "META node count does not match TREE")
        playback = next((channel for channel in binding_channels
                         if channel["interpreter"] in ("polycss-playback@0",
                                                       "polycss-paged-playback@0")), None)
        actual_counts = {"shapes": None, "leaves": None, "sourceFrames": None}
        if playback is not None:
            targets = playback["targets"]
            shapes, leaves = targets.get("shapes"), targets.get("leaves")
            require(isinstance(shapes, list) and isinstance(leaves, list),
                    "TARGET_CARDINALITY_MISMATCH", "Playback count targets must be arrays")
            parameters = playback["parameters"]
            frame_count = as_int(parameters.get("frameCount"), "INVALID_CODEC_BINDING",
                                 "polycss-playback@0 frameCount", 1)
            actual_counts = {
                "shapes": len(shapes),
                "leaves": len(leaves),
                "sourceFrames": frame_count,
            }
        for name, actual in actual_counts.items():
            if name in counts:
                require(actual is not None and as_int(counts[name], "META_COUNT_MISMATCH", f"META {name} count") == actual,
                        "META_COUNT_MISMATCH", f"META {name} count does not match playback")
    used_resources = set()
    for binding in stylesheets:
        used_resources.add(binding["resource"])
        used_resources.update(entry["resource"] for entry in binding["assetTokens"])
    used_resources.update(binding["resource"] for binding in document["tree"]["mount"].get("resourceStyles", {}).values())
    for node in nodes:
        used_resources.update(node.get("resourceAttributes", {}).values())
        used_resources.update(binding["resource"] for binding in node.get("resourceStyles", {}).values())
    presentation = next((channel for channel in state_channels if channel["codec"] == "static-presentation@0"), None)
    if presentation is not None and presentation["data"]["packet"].get("background") is not None:
        used_resources.add(presentation["data"]["packet"]["background"].get("resource"))
    paged_variants = next((channel for channel in state_channels
                           if channel["codec"] == "polycss-paged-variants@0"), None)
    if paged_variants is not None:
        for page in paged_variants["data"]["packet"]["pages"]:
            resource = resource_map.get(page["resource"])
            require(resource is not None and resource["kind"] == "state-page"
                    and resource["codec"] == "polycss-paged-variants-page@0",
                    "RESOURCE_ROLE_MISMATCH", "Paged variant resource is not a matching state page")
            used_resources.add(page["resource"])
    paged_playback = next((channel for channel in state_channels
                           if channel["codec"] == "polycss-paged-playback@0"), None)
    if paged_playback is not None:
        for page in paged_playback["data"]["packet"]["pages"]:
            resource = resource_map.get(page["resource"])
            require(resource is not None and resource["kind"] == "state-page"
                    and resource["codec"] == "polycss-paged-playback-page@0",
                    "RESOURCE_ROLE_MISMATCH", "Paged playback resource is not a matching state page")
            used_resources.add(page["resource"])
    paged_packets = [channel["data"]["packet"] for channel in (paged_playback, paged_variants)
                     if channel is not None]
    if paged_packets:
        playback_binding = next(channel for channel in binding_channels
                                if channel["interpreter"] in ("polycss-playback@0",
                                                              "polycss-paged-playback@0"))
        playback_state = next(channel for channel in state_channels
                              if channel["codec"] in ("polycss-playback-packed@0",
                                                      "polycss-paged-playback@0"))
        interaction = next((channel for channel in binding_channels
                            if channel["interpreter"] == "polycss-pointer-grab@0"), None)
        pins = [playback_state["data"]["packet"]["initial"]["sourceFrame"]]
        if interaction is not None:
            pins.append(interaction["parameters"]["initialFrame"])
        materialized = {page["resource"]: page["materializedByteLength"]
                        for packet in paged_packets for page in packet["pages"]}
        playback_packet = paged_playback["data"]["packet"] if paged_playback is not None else None
        variant_target_count = 0
        if paged_variants is not None:
            variant_binding = next(channel for channel in binding_channels
                                   if channel["interpreter"] == "polycss-paged-variants@0")
            variant_target_count = len(variant_binding["targets"]["nodes"])
        retained_live = variant_target_count * 4
        if playback_packet is not None:
            shape_count = int(playback_packet["shapeCount"])
            leaf_count = int(playback_packet["leafCount"])
            retained_live += max(int(page["materializedByteLength"]) + 16
                                 + (shape_count + leaf_count) * 8 + shape_count
                                 for page in playback_packet["pages"])
        peak = 0
        for frame in range(1, int(playback_binding["parameters"]["frameCount"]) + 1):
            desired: set[str] = set()
            for packet in paged_packets:
                desired.update(desired_page_resources(packet, frame, pins))
            resident = sum(int(materialized[resource]) for resource in desired)
            publication_workspace = variant_target_count * 4
            if playback_packet is not None:
                current = next(page for page in playback_packet["pages"]
                               if page["startFrame"] <= frame <= page["endFrame"])
                publication_workspace += (int(current["materializedByteLength"]) + 16
                                          + (shape_count + leaf_count) * 8 + shape_count
                                          + (shape_count + leaf_count) * 12 + shape_count)
            peak = max(peak, resident + retained_live + publication_workspace)
            for resource in desired:
                record = resource_map[resource]
                validation_peak = (resident - int(materialized[resource])
                                   + int(record["decodedByteLength"]) * 10
                                   + int(materialized[resource]) * 2 + retained_live)
                peak = max(peak, validation_peak)
        require(peak <= limits["decoded_total"], "STATE_PAGE_RESIDENCY_LIMIT",
                "Paged state validation and resident window exceeds decoded byte ceiling")
    require(used_resources == set(resource_map), "UNUSED_RESOURCE",
            "Every resource must be reachable from TREE, CSSB, or prepared presentation state")
    resource_bytes: dict[str, bytes] = {}
    if require_resources:
        lexical_base = path.parent.absolute()
        base = real_directory(lexical_base, "UNSAFE_RESOURCE_PATH",
                              "Resource directory")
        for record in records:
            relative = safe_path(record["path"], f"resource {record['id']} path")
            lexical_target = base / relative
            try:
                reject_symlink_components(base, relative, "UNSAFE_RESOURCE_PATH",
                                          f"Resource {record['id']} path")
                target = lexical_target.resolve(strict=True)
                require(target == base or base in target.parents, "UNSAFE_RESOURCE_PATH",
                        "Resource resolves outside package directory")
                expected = as_int(record["byteLength"], "RESOURCE_SIZE_MISMATCH", "resource size")
                payload, opened = read_capped_file(
                    lexical_target, min(expected, limits["resource"]),
                    f"resource {record['id']}", expected, True)
                final_target = lexical_target.resolve(strict=True)
                require(final_target == base or base in final_target.parents,
                        "UNSAFE_RESOURCE_PATH", "Resource moved outside package directory")
                final_metadata = os.stat(lexical_target)
                require(final_metadata.st_dev == opened.st_dev and final_metadata.st_ino == opened.st_ino,
                        "FILE_CHANGED_DURING_READ", f"Resource {record['id']} path changed while loading")
                resource_bytes[record["id"]] = payload
            except OSError as error:
                raise DomError("MISSING_EXTERNAL_RESOURCE", f"Cannot read resource {record['id']}: {error}") from error
    decoded_state_pages: dict[str, dict] = {}
    for record in records:
        payload = resource_bytes.get(record["id"])
        if payload is None:
            continue
        require(len(payload) == as_int(record["byteLength"], "RESOURCE_SIZE_MISMATCH", "resource size"),
                "RESOURCE_SIZE_MISMATCH", f"Resource {record['id']} size mismatch")
        require(hashlib.sha256(payload).hexdigest() == record["digest"]["value"],
                "RESOURCE_DIGEST_MISMATCH", f"Resource {record['id']} digest mismatch")
        if record["kind"] == "image":
            width, height = image_dimensions(payload, record["mediaType"])
            require(width == as_int(record["dimensions"]["width"], "IMAGE_DIMENSION_MISMATCH", "width")
                    and height == as_int(record["dimensions"]["height"], "IMAGE_DIMENSION_MISMATCH", "height"),
                    "IMAGE_DIMENSION_MISMATCH", f"Resource {record['id']} dimensions mismatch")
        elif record["kind"] == "state-page":
            decoded_length = int(record["decodedByteLength"])
            require(record["encoding"] == "identity"
                    or (len(payload) >= 2 and payload[:2] == b"\x1f\x8b"),
                    "STATE_PAGE_DECODE_FAILED", f"State page {record['id']} encoding differs")
            if record["encoding"] == "identity":
                decoded = payload
            else:
                try:
                    with gzip.GzipFile(fileobj=io.BytesIO(payload), mode="rb") as archive:
                        decoded = archive.read(decoded_length + 1)
                except (OSError, EOFError) as error:
                    raise DomError("STATE_PAGE_DECODE_FAILED",
                                   f"State page {record['id']} gzip decode failed") from error
            require(len(decoded) == decoded_length,
                    "STATE_PAGE_DECODED_SIZE_MISMATCH",
                    f"State page {record['id']} decoded length differs")
            require(hashlib.sha256(decoded).hexdigest() == record["decodedDigest"]["value"],
                    "STATE_PAGE_DECODED_DIGEST_MISMATCH",
                    f"State page {record['id']} decoded digest differs")
            decoded_state_pages[record["id"]] = validate_state_page_payload(
                document, record, decoded, limits)
    validate_decoded_state_page_closure(document, decoded_state_pages)
    variant_channel = next((channel for channel in document["state"]["channels"]
                            if channel["codec"] in ("polycss-variants-packed@0",
                                                    "polycss-paged-variants@0")), None)
    forbidden_class_tokens = set(variant_channel["data"]["packet"]["classes"]) if variant_channel else set()
    for binding in stylesheets:
        payload = resource_bytes.get(binding["resource"])
        if payload is not None:
            validate_css(payload, binding, resource_map, limits, forbidden_class_tokens)
    if require_resources:
        require(len(resource_bytes) == len(records), "MISSING_EXTERNAL_RESOURCE", "External resources missing")
    plan_rows = [[node["id"], int(node["parent"]), int(node["sibling"]), node["namespace"], node["name"]]
                 for node in nodes]
    binding_rows = [[channel["id"], channel["state"], channel["interpreter"], channel["targets"], channel["sinks"]]
                    for channel in binding_channels]
    return {
        "document": document,
        "transport": {
            "encoding": encoding,
            "decodedBytes": len(json_bytes),
        },
        "resourceBytes": resource_bytes,
        "summary": {
            "format": document["meta"]["format"],
            "profile": document["meta"]["profile"],
            "bytes": len(data),
            "nodes": len(nodes),
            "stateChannels": len(state_channels),
            "bindingChannels": len(binding_channels),
            "resources": len(records),
            "allResourcesVerified": len(resource_bytes) == len(records),
            "treePayloadSha256": hashlib.sha256(canonical_encode(document["tree"])).hexdigest(),
            "constructionPlanSha256": hashlib.sha256(canonical_encode(plan_rows)).hexdigest(),
            "bindingPlanSha256": hashlib.sha256(canonical_encode(binding_rows)).hexdigest(),
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Independent domformat@0 reader")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "inspect"):
        sub = subparsers.add_parser(command)
        sub.add_argument("file", type=Path)
        sub.add_argument("--no-resources", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = read_dom(args.file, not args.no_resources)
        if args.command == "validate":
            summary = result["summary"]
            print(f"valid {summary['format']} {summary['profile']}; {summary['bytes']} bytes; "
                  f"{summary['nodes']} nodes; {summary['resources']} resources verified")
        else:
            print(json.dumps(result["summary"], indent=2, sort_keys=True))
        return 0
    except DomError as error:
        print(f"domformat-python: {error.code}: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"domformat-python: IO_ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
