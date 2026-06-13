#!/usr/bin/env python3
"""CLI to download YouTube video transcript from a video URL.

Usage:
    python youtube/get_transcript.py <url> [options]

Examples:
    python youtube/get_transcript.py https://www.youtube.com/watch?v=dQw4w9WgXcQ
    python youtube/get_transcript.py dQw4w9WgXcQ -o ross
    python youtube/get_transcript.py <url> -o ross -d 2026-03-19
    python youtube/get_transcript.py <url> -l en es
    python youtube/get_transcript.py <url> -s -o rizom
"""

import os
import sys
import re
import argparse
import textwrap
from datetime import date
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".." / ".env")


def build_instructions(out_dir: Path) -> str:
    channel = out_dir.parts[-2] if len(out_dir.parts) >= 2 else ""
    instructions = "Summarize the following YouTube video transcript concisely, highlighting the key points and takeaways."
    if channel in ("rizom", "titans"):
        instructions += "\nWhat are actionable advices that can be added to small cap day trader playbook?"
    if channel == "ross":
        instructions += (
            "\nWhat stocks did Ross mention in this text?"
            "\nWhat did he trade and why? Describe his entries and exits."
        )
    return instructions


def summarize_transcript(text: str, out_dir: Path, out_path: Path) -> None:
    try:
        import anthropic
    except ImportError:
        print("\nError: anthropic is not installed.")
        print("Install it with: pip install anthropic")
        sys.exit(1)

    client = anthropic.Anthropic()
    print("\n--- Summary ---")
    chunks = []
    with client.messages.stream(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-6"),
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": f"{build_instructions(out_dir)}\n\n{text}"
        }]
    ) as stream:
        for chunk in stream.text_stream:
            print(chunk, end="", flush=True)
            chunks.append(chunk)
    print()

    takeaways_path = out_path.with_stem(out_path.stem + "_takeaways")
    takeaways = "\n\n".join(
        textwrap.fill(para, width=80)
        for para in "".join(chunks).split("\n\n")
    )
    takeaways_path.write_text(takeaways, encoding="utf-8")
    print(f"Takeaways saved to {takeaways_path}")


def slugify(title: str, max_chars: int = 30) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    if len(slug) <= max_chars:
        return slug
    truncated = slug[:max_chars]
    last_underscore = truncated.rfind("_")
    return truncated[:last_underscore] if last_underscore > 0 else truncated


def get_video_metadata(video_id: str) -> dict:
    try:
        import yt_dlp
    except ImportError:
        print("Warning: yt-dlp is not installed, skipping metadata fetch.")
        print("Install it with: pip install yt-dlp")
        return {}

    ydl_opts = {"quiet": True, "skip_download": True, "no_warnings": True}
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    upload_date = info.get("upload_date", "")  # YYYYMMDD
    if upload_date:
        upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    return {"title": info.get("title", ""), "upload_date": upload_date}


def extract_video_id(url: str) -> str:
    patterns = [
        r"(?:v=|youtu\.be/|embed/|shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    # Assume raw video ID was passed
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url):
        return url
    raise ValueError(f"Could not extract video ID from: {url}")


def get_transcript(video_id: str, languages=None) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
    except ImportError:
        print("Error: youtube-transcript-api is not installed.")
        print("Install it with: pip install youtube-transcript-api")
        sys.exit(1)

    try:
        api = YouTubeTranscriptApi()
        if languages:
            fetched = api.fetch(video_id, languages=languages)
        else:
            fetched = api.fetch(video_id, languages=["en"])
        text = " ".join(entry.text for entry in fetched)
        return textwrap.fill(text, width=80)

    except TranscriptsDisabled:
        print("Error: Transcripts are disabled for this video.")
        sys.exit(1)
    except NoTranscriptFound:
        print("Error: No transcript found for this video.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Download the full transcript of a YouTube video."
    )
    parser.add_argument("url", help="YouTube video URL or video ID")
    parser.add_argument(
        "-o", "--output", metavar="PREFIX", default=None,
        help="Optional prefix for the output filename (e.g. 'ross' → ross_2026-03-17.txt)"
    )
    parser.add_argument(
        "-d", "--date", metavar="DATE", default=None,
        help="Date for file/folder naming in YYYY-MM-DD format (default: today)"
    )
    parser.add_argument(
        "-l", "--languages", metavar="LANG", nargs="+",
        help="Preferred language codes in order (e.g. en es fr)"
    )
    parser.add_argument(
        "-s", "--summarize", action="store_true",
        help="Generate AI summary and takeaways"
    )
    args = parser.parse_args()

    video_id = extract_video_id(args.url)

    metadata = get_video_metadata(video_id)
    if metadata.get("title"):
        print(f"Title: {metadata['title']}")

    if args.date:
        today = args.date
    elif metadata.get("upload_date"):
        today = metadata["upload_date"]
    else:
        today = date.today().strftime("%Y-%m-%d")
    base_dir = Path(__file__).parent / ".." / ".." / ".." / "youtube_transcripts"

    title_slug = slugify(metadata["title"]) if metadata.get("title") else ""
    stem = f"{today}_{title_slug}" if title_slug else today

    if args.output:
        out_dir = base_dir / args.output / today
        filename = f"{args.output}_{stem}.txt"
    else:
        out_dir = base_dir / today
        filename = f"{stem}.txt"

    out_path = out_dir / filename

    if out_path.exists():
        print(f"Transcript already exists at {out_path}, skipping download.")
        text = out_path.read_text(encoding="utf-8")
    else:
        text = get_transcript(video_id, args.languages)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        print(f"Transcript saved to {out_path}")
    if args.summarize:
        summarize_transcript(text, out_dir, out_path)


if __name__ == "__main__":
    main()
