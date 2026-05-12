#!/usr/bin/env python
"""
Build a 6-minute cinematic showcase video for BIT-Booking3.
- Captures real rendered pages from the local frontend via Playwright.
- Composes a sci-fi style timeline with animated overlays.
- Generates neural narration voiceover.
- Exports final MP4 to C:\\Users\\vasud\\Videos.
"""

import asyncio
import math
import random
import re
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

import cv2
import numpy as np
import edge_tts
import imageio_ffmpeg
from playwright.async_api import async_playwright

WIDTH = 1920
HEIGHT = 1080
FPS = 30
TARGET_SECONDS = 360
TARGET_FRAMES = FPS * TARGET_SECONDS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = PROJECT_ROOT / "video_render"
SCREEN_DIR = OUTPUT_ROOT / "screens"
ASSET_DIR = OUTPUT_ROOT / "assets"

SILENT_VIDEO_PATH = OUTPUT_ROOT / "showcase_silent.mp4"
RAW_NARRATION_PATH = ASSET_DIR / "narration_raw.mp3"
TIMED_NARRATION_PATH = ASSET_DIR / "narration_timed.mp3"
AMBIENT_PATH = ASSET_DIR / "ambient.wav"
MIXED_AUDIO_PATH = ASSET_DIR / "voiceover_mix.mp3"
FINAL_VIDEO_PATH = Path(r"C:\Users\vasud\Videos\BIT_Booking3_SciFi_Showcase.mp4")

FFMPEG_EXE = Path(imageio_ffmpeg.get_ffmpeg_exe())
BASE_URL = "http://localhost:3000"

ROUTES = [
    {
        "slug": "home",
        "path": "/",
        "title": "Home Experience",
        "focus": "A premium landing experience presenting smart campus hall booking with polished visuals and quick access actions.",
    },
    {
        "slug": "about",
        "path": "/about",
        "title": "About Platform",
        "focus": "A clean explanation of system goals, user roles, and modernization of institutional booking operations.",
    },
    {
        "slug": "faqs",
        "path": "/faqs",
        "title": "FAQ Support",
        "focus": "A guided support surface for common questions, reducing friction for first-time users and coordinators.",
    },
    {
        "slug": "ai",
        "path": "/ai",
        "title": "AI Immersive",
        "focus": "An AI-first interaction layer designed for natural language support, routing, and intelligent task assistance.",
    },
    {
        "slug": "schedule",
        "path": "/schedule",
        "title": "Schedule Overview",
        "focus": "A timeline-focused booking interface that improves visibility into usage patterns and hall allocation.",
    },
    {
        "slug": "notices",
        "path": "/notices",
        "title": "Notice Center",
        "focus": "An announcement surface for operational updates, policy changes, and live institutional communication.",
    },
    {
        "slug": "calendar",
        "path": "/calendar",
        "title": "Calendar Grid",
        "focus": "A full calendar view that makes occupancy decisions fast, visual, and reliable for administrators.",
    },
    {
        "slug": "admin_login",
        "path": "/admin_login",
        "title": "Admin Access",
        "focus": "A secure entry point for admin operations with privileged control over booking approvals and resources.",
    },
    {
        "slug": "dept_login",
        "path": "/department_login",
        "title": "Department Access",
        "focus": "Dedicated role-based login for departments to request bookings and manage their hall usage lifecycle.",
    },
    {
        "slug": "dept_register",
        "path": "/department_register",
        "title": "Department Onboarding",
        "focus": "A streamlined onboarding path enabling new departments to join the platform with identity validation.",
    },
    {
        "slug": "developer_login",
        "path": "/developer/login",
        "title": "Developer Entry",
        "focus": "A dedicated portal for technical operations, monitoring visibility, and deeper system diagnostics.",
    },
    {
        "slug": "complaints",
        "path": "/complaints",
        "title": "Complaints Workflow",
        "focus": "A structured grievance workflow for capturing and tracking incident reports across stakeholders.",
    },
    {
        "slug": "queries",
        "path": "/queries",
        "title": "Queries Desk",
        "focus": "A query management channel that centralizes requests and improves response quality over time.",
    },
    {
        "slug": "feedback",
        "path": "/feedback",
        "title": "Feedback Insights",
        "focus": "A sentiment and feedback capture page built to drive continuous product and service improvement.",
    },
    {
        "slug": "trash",
        "path": "/trash",
        "title": "Audit Bin",
        "focus": "A recoverable trash workflow supporting safer moderation and operational data hygiene.",
    },
]


def run_cmd(command: list[str], check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True)
    if check and result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        raise RuntimeError(f"Command failed: {' '.join(command)}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}")
    return result


def ensure_dirs() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    SCREEN_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    FINAL_VIDEO_PATH.parent.mkdir(parents=True, exist_ok=True)


def create_placeholder(path: Path, title: str, reason: str) -> None:
    canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    canvas[:] = (10, 14, 22)
    cv2.putText(canvas, "BIT-Booking3 Capture Placeholder", (130, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (120, 220, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, title, (130, 390), cv2.FONT_HERSHEY_DUPLEX, 1.2, (240, 245, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, reason[:80], (130, 460), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (180, 190, 210), 1, cv2.LINE_AA)
    cv2.imwrite(str(path), canvas)


async def capture_route_screens() -> list[dict]:
    captures: list[dict] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": WIDTH, "height": HEIGHT}, color_scheme="dark")
        page = await context.new_page()
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120000)
        await page.wait_for_timeout(2000)

        for idx, route in enumerate(ROUTES):
            url = f"{BASE_URL}{route['path']}"
            print(f"[capture] {url}")

            top_file = SCREEN_DIR / f"{idx:02d}_{route['slug']}_top.png"
            mid_file = SCREEN_DIR / f"{idx:02d}_{route['slug']}_mid.png"

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=120000)
                await page.wait_for_timeout(2500)

                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(400)
                await page.screenshot(path=str(top_file), full_page=False)

                await page.evaluate(
                    """() => {
                        const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                        window.scrollTo({ top: Math.floor(h * 0.45), behavior: 'smooth' });
                    }"""
                )
                await page.wait_for_timeout(1700)
                await page.screenshot(path=str(mid_file), full_page=False)
            except Exception as exc:
                reason = str(exc).replace("\n", " ")
                create_placeholder(top_file, route["title"], reason)
                create_placeholder(mid_file, f"{route['title']} - Scroll", reason)

            captures.append({
                "file": top_file,
                "title": route["title"],
                "path": route["path"],
                "focus": route["focus"],
            })
            captures.append({
                "file": mid_file,
                "title": f"{route['title']} (Details)",
                "path": route["path"],
                "focus": route["focus"],
            })

        await context.close()
        await browser.close()

    return captures


def build_narration_text() -> str:
    intro = (
        "Welcome to BIT Booking 3, a modern intelligent campus hall booking ecosystem. "
        "In this six minute guided cinematic walkthrough, we explore the full interface, role based journeys, "
        "AI enhanced support layers, and the operational logic behind reliable, transparent booking decisions."
    )

    architecture = (
        "This platform blends clean user experience design with a robust technical core. "
        "Behind the scenes, the system combines role based workflows, approval pipelines, live data surfaces, "
        "and an AI orchestration layer for support and routing. The result is faster coordination, reduced ambiguity, "
        "and stronger administrative control across the full hall lifecycle."
    )

    route_blocks = []
    for route in ROUTES:
        route_blocks.append(
            f"Now we move to the {route['title']} screen at route {route['path']}. "
            f"Here, {route['focus']} "
            "Notice the emphasis on clarity, reduced friction, and consistency across navigation patterns, "
            "which helps both first time users and frequent operators work with confidence."
        )

    operations = (
        "Across these pages, we see the system unifying discovery, request submission, validation, administration, "
        "and communication. Teams can monitor halls, handle requests, respond to complaints and queries, "
        "and keep records organized through structured interfaces that remain intuitive under real operational load."
    )

    ai_layer = (
        "A standout capability is the AI layer, designed to assist with support interactions and guided problem solving. "
        "This enables a more responsive experience where common issues can be resolved quickly while human administrators "
        "retain control over sensitive approvals and policy critical actions."
    )

    closing = (
        "BIT Booking 3 demonstrates how thoughtful product design and practical engineering can modernize institutional workflows. "
        "From landing experience to role specific control panels, from calendar intelligence to support management, "
        "the platform delivers a cohesive digital command center for campus booking operations."
    )

    full_text = " ".join([intro, architecture] + route_blocks + [operations, ai_layer, closing])
    return " ".join(full_text.split())


async def generate_narration(text: str, output_path: Path) -> None:
    communicate = edge_tts.Communicate(
        text,
        voice="en-US-ChristopherNeural",
        rate="+0%",
        pitch="+0Hz",
        volume="+0%",
    )
    await communicate.save(str(output_path))


def parse_media_duration_seconds(media_path: Path) -> float:
    result = run_cmd([str(FFMPEG_EXE), "-i", str(media_path)], check=False)
    combined = (result.stdout or "") + "\n" + (result.stderr or "")
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", combined)
    if not match:
        raise RuntimeError(f"Could not parse duration for {media_path}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def atempo_filter_chain(speed_ratio: float) -> str:
    # output_duration = input_duration / speed_ratio
    # speed_ratio > 1 speeds up audio, <1 slows down
    factors = []
    remaining = speed_ratio

    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0

    while remaining < 0.5:
        factors.append(0.5)
        remaining /= 0.5

    factors.append(remaining)
    return ",".join(f"atempo={f:.6f}" for f in factors)


def create_timed_narration(raw_path: Path, timed_path: Path, target_seconds: float) -> float:
    raw_duration = parse_media_duration_seconds(raw_path)
    speed_ratio = raw_duration / target_seconds
    filter_chain = atempo_filter_chain(speed_ratio)

    run_cmd(
        [
            str(FFMPEG_EXE),
            "-y",
            "-i",
            str(raw_path),
            "-filter:a",
            filter_chain,
            "-t",
            f"{target_seconds:.3f}",
            "-ar",
            "48000",
            str(timed_path),
        ]
    )

    return parse_media_duration_seconds(timed_path)


def generate_ambient_bed(path: Path, duration_seconds: float, sample_rate: int = 48000) -> None:
    total_samples = int(duration_seconds * sample_rate)
    t = np.linspace(0, duration_seconds, total_samples, endpoint=False)

    # Layered cinematic synth bed
    carrier = 0.22 * np.sin(2 * np.pi * (48 + 3 * np.sin(2 * np.pi * t / 22.0)) * t)
    shimmer = 0.10 * np.sin(2 * np.pi * (120 + 8 * np.sin(2 * np.pi * t / 17.0)) * t + 0.3)
    pulse = 0.08 * np.sin(2 * np.pi * 0.12 * t)

    rng = np.random.default_rng(42)
    noise = rng.normal(0, 1, total_samples)
    kernel = np.ones(1100) / 1100.0
    smooth_noise = np.convolve(noise, kernel, mode="same")
    air = 0.04 * smooth_noise

    signal = carrier + shimmer + pulse + air
    signal = signal / max(1e-6, np.max(np.abs(signal)))
    signal *= 0.23

    stereo = np.stack([signal, signal], axis=1)
    pcm = np.int16(np.clip(stereo, -1.0, 1.0) * 32767)

    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def mix_voice_and_ambient(voice_path: Path, ambient_path: Path, output_path: Path, duration_seconds: float) -> None:
    run_cmd(
        [
            str(FFMPEG_EXE),
            "-y",
            "-i",
            str(voice_path),
            "-i",
            str(ambient_path),
            "-filter_complex",
            "[0:a]volume=1.05[v];[1:a]volume=0.20[a];[v][a]amix=inputs=2:duration=first:dropout_transition=2[m]",
            "-map",
            "[m]",
            "-t",
            f"{duration_seconds:.3f}",
            "-ar",
            "48000",
            str(output_path),
        ]
    )


def cover_resize(image: np.ndarray) -> np.ndarray:
    h, w = image.shape[:2]
    scale = max(WIDTH / w, HEIGHT / h)
    new_w = int(w * scale)
    new_h = int(h * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    x0 = (new_w - WIDTH) // 2
    y0 = (new_h - HEIGHT) // 2
    return resized[y0:y0 + HEIGHT, x0:x0 + WIDTH]


def ken_burns_frame(base_image: np.ndarray, t: float, shift_seed: float) -> np.ndarray:
    # t in [0,1]
    zoom = 1.0 + 0.12 * t
    crop_w = int(WIDTH / zoom)
    crop_h = int(HEIGHT / zoom)

    cx = WIDTH // 2 + int(math.sin((t + shift_seed) * 2 * math.pi) * 80)
    cy = HEIGHT // 2 + int(math.cos((t + shift_seed) * 2 * math.pi) * 45)

    x1 = max(0, min(WIDTH - crop_w, cx - crop_w // 2))
    y1 = max(0, min(HEIGHT - crop_h, cy - crop_h // 2))

    crop = base_image[y1:y1 + crop_h, x1:x1 + crop_w]
    return cv2.resize(crop, (WIDTH, HEIGHT), interpolation=cv2.INTER_CUBIC)


def draw_scanlines(frame: np.ndarray, frame_index: int) -> None:
    for y in range(0, HEIGHT, 4):
        intensity = 12 + int(5 * math.sin((y + frame_index * 2) * 0.05))
        cv2.line(frame, (0, y), (WIDTH, y), (intensity, intensity, intensity), 1)


def draw_hud(frame: np.ndarray, global_frame: int, shot_title: str, shot_path: str, shot_progress: float) -> None:
    overlay = frame.copy()

    # Top and bottom bars
    cv2.rectangle(overlay, (0, 0), (WIDTH, 86), (8, 15, 26), -1)
    cv2.rectangle(overlay, (0, HEIGHT - 80), (WIDTH, HEIGHT), (8, 15, 26), -1)

    # Corner accents
    color = (70, 220, 255)
    cv2.line(overlay, (40, 40), (220, 40), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (40, 40), (40, 140), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (WIDTH - 40, 40), (WIDTH - 220, 40), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (WIDTH - 40, 40), (WIDTH - 40, 140), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (40, HEIGHT - 40), (220, HEIGHT - 40), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (40, HEIGHT - 40), (40, HEIGHT - 140), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (WIDTH - 40, HEIGHT - 40), (WIDTH - 220, HEIGHT - 40), color, 2, cv2.LINE_AA)
    cv2.line(overlay, (WIDTH - 40, HEIGHT - 40), (WIDTH - 40, HEIGHT - 140), color, 2, cv2.LINE_AA)

    frame[:] = cv2.addWeighted(overlay, 0.35, frame, 0.65, 0)

    cv2.putText(frame, "BIT-BOOKING3 // CINEMATIC WALKTHROUGH", (72, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (190, 240, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, f"ROUTE: {shot_path}", (72, HEIGHT - 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (140, 225, 255), 2, cv2.LINE_AA)
    cv2.putText(frame, shot_title.upper(), (72, HEIGHT - 118), cv2.FONT_HERSHEY_DUPLEX, 0.95, (245, 250, 255), 2, cv2.LINE_AA)

    # Progress bar
    x0, y0, w, h = 72, HEIGHT - 18, WIDTH - 144, 8
    cv2.rectangle(frame, (x0, y0), (x0 + w, y0 + h), (40, 60, 90), -1)
    cv2.rectangle(frame, (x0, y0), (x0 + int(w * shot_progress), y0 + h), (65, 230, 255), -1)

    # Sweeping line
    x_sweep = int((global_frame * 7) % WIDTH)
    cv2.line(frame, (x_sweep, 90), (x_sweep, HEIGHT - 90), (30, 100, 130), 1, cv2.LINE_AA)


def render_intro_frame(frame_index: int, total_intro_frames: int) -> np.ndarray:
    t = frame_index / max(1, total_intro_frames - 1)
    canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    canvas[:] = (6, 10, 18)

    # Gradient glow
    cx = int(WIDTH * 0.5 + math.sin(t * 2 * math.pi) * 120)
    cy = int(HEIGHT * 0.5)
    for r in range(420, 40, -16):
        alpha = (420 - r) / 420
        color = (int(30 + 60 * alpha), int(40 + 130 * alpha), int(80 + 170 * alpha))
        cv2.circle(canvas, (cx, cy), r, color, 2)

    title_alpha = min(1.0, t * 2.5)
    subtitle_alpha = max(0.0, (t - 0.15) * 2.2)

    title_color = tuple(int(c * title_alpha) for c in (210, 245, 255))
    sub_color = tuple(int(c * subtitle_alpha) for c in (130, 220, 250))

    cv2.putText(canvas, "BIT-BOOKING3", (560, 500), cv2.FONT_HERSHEY_DUPLEX, 2.2, title_color, 4, cv2.LINE_AA)
    cv2.putText(canvas, "AI-ENABLED CAMPUS HALL BOOKING SYSTEM", (390, 575), cv2.FONT_HERSHEY_SIMPLEX, 0.9, sub_color, 2, cv2.LINE_AA)

    line_y = 640
    line_len = int((0.15 + 0.85 * t) * 900)
    cv2.line(canvas, (WIDTH // 2 - line_len // 2, line_y), (WIDTH // 2 + line_len // 2, line_y), (80, 220, 255), 2, cv2.LINE_AA)

    draw_scanlines(canvas, frame_index)
    return canvas


def render_outro_frame(frame_index: int, total_outro_frames: int) -> np.ndarray:
    t = frame_index / max(1, total_outro_frames - 1)
    canvas = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    canvas[:] = (5, 8, 14)

    alpha = 1.0 - t
    color_main = tuple(int(c * alpha) for c in (220, 245, 255))
    color_sub = tuple(int(c * alpha) for c in (130, 215, 240))

    cv2.putText(canvas, "THANK YOU", (760, 470), cv2.FONT_HERSHEY_DUPLEX, 1.8, color_main, 3, cv2.LINE_AA)
    cv2.putText(canvas, "BIT-BOOKING3 PROJECT SHOWCASE", (560, 550), cv2.FONT_HERSHEY_SIMPLEX, 0.95, color_sub, 2, cv2.LINE_AA)
    cv2.putText(canvas, "Generated from live project routes and code-driven render pipeline", (430, 620), cv2.FONT_HERSHEY_SIMPLEX, 0.72, color_sub, 1, cv2.LINE_AA)

    draw_scanlines(canvas, frame_index)
    return canvas


def compose_video(captures: list[dict], output_path: Path) -> None:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output_path), fourcc, FPS, (WIDTH, HEIGHT))

    if not writer.isOpened():
        raise RuntimeError("Failed to initialize video writer.")

    intro_frames = 20 * FPS
    outro_frames = 12 * FPS
    content_frames = TARGET_FRAMES - intro_frames - outro_frames

    if content_frames <= 0:
        raise RuntimeError("Invalid timeline configuration.")

    image_frames_each = content_frames // len(captures)
    remaining_frames = content_frames - image_frames_each * len(captures)

    # Intro
    for i in range(intro_frames):
        frame = render_intro_frame(i, intro_frames)
        writer.write(frame)

    global_counter = intro_frames

    prepared = []
    for capture in captures:
        img = cv2.imread(str(capture["file"]))
        if img is None:
            img = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
            img[:] = (20, 20, 30)
        prepared.append((cover_resize(img), capture))

    for idx, (base_img, capture) in enumerate(prepared):
        shot_frames = image_frames_each + (1 if idx < remaining_frames else 0)
        shift_seed = (idx * 0.173) % 1.0

        for local_idx in range(shot_frames):
            shot_t = local_idx / max(1, shot_frames - 1)
            frame = ken_burns_frame(base_img, shot_t, shift_seed)

            # Subtle cyan tint for modern tech mood
            tint = np.full_like(frame, (12, 22, 34))
            frame = cv2.addWeighted(frame, 0.90, tint, 0.10, 0)

            draw_hud(frame, global_counter, capture["title"], capture["path"], shot_t)
            draw_scanlines(frame, global_counter)

            # Light vignette
            yy, xx = np.indices((HEIGHT, WIDTH))
            dx = (xx - WIDTH / 2.0) / (WIDTH / 2.0)
            dy = (yy - HEIGHT / 2.0) / (HEIGHT / 2.0)
            dist = np.sqrt(dx * dx + dy * dy)
            vignette = np.clip(1.0 - 0.28 * dist, 0.65, 1.0)
            frame = np.clip(frame.astype(np.float32) * vignette[..., None], 0, 255).astype(np.uint8)

            writer.write(frame)
            global_counter += 1

    # Outro
    for i in range(outro_frames):
        frame = render_outro_frame(i, outro_frames)
        writer.write(frame)

    writer.release()


def mux_video_and_audio(video_path: Path, audio_path: Path, output_path: Path) -> None:
    run_cmd(
        [
            str(FFMPEG_EXE),
            "-y",
            "-i",
            str(video_path),
            "-i",
            str(audio_path),
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
    )


async def main() -> None:
    ensure_dirs()

    if not FFMPEG_EXE.exists():
        raise RuntimeError(f"FFmpeg executable not found at {FFMPEG_EXE}")

    print("[1/6] Capturing rendered routes...")
    captures = await capture_route_screens()

    print("[2/6] Building narration script and voiceover...")
    narration_text = build_narration_text()
    await generate_narration(narration_text, RAW_NARRATION_PATH)

    print("[3/6] Timing narration to exactly 6 minutes...")
    timed_duration = create_timed_narration(RAW_NARRATION_PATH, TIMED_NARRATION_PATH, TARGET_SECONDS)
    print(f"Timed narration duration: {timed_duration:.2f}s")

    print("[4/6] Generating cinematic ambient bed and mixing audio...")
    generate_ambient_bed(AMBIENT_PATH, TARGET_SECONDS)
    mix_voice_and_ambient(TIMED_NARRATION_PATH, AMBIENT_PATH, MIXED_AUDIO_PATH, TARGET_SECONDS)

    print("[5/6] Rendering sci-fi showcase video frames...")
    compose_video(captures, SILENT_VIDEO_PATH)

    print("[6/6] Muxing video + voiceover and exporting final MP4...")
    mux_video_and_audio(SILENT_VIDEO_PATH, MIXED_AUDIO_PATH, FINAL_VIDEO_PATH)

    print(f"Done. Final video saved to: {FINAL_VIDEO_PATH}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)
