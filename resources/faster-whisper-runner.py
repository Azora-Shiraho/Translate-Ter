import argparse
import json
import sys
from importlib import metadata


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["health", "transcribe"], required=True)
    parser.add_argument("--audio-path")
    parser.add_argument("--model", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--cpu-threads", type=int, default=0)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--local-files-only", action="store_true")
    return parser.parse_args()


def runner_health(args):
    try:
        import faster_whisper
        import ctranslate2
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        print(json.dumps({"ok": False, "message": str(exc)}))
        return 1

    cuda_device_count = None
    if args.device == "cuda":
        try:
            cuda_device_count = ctranslate2.get_cuda_device_count()
            if cuda_device_count <= 0:
                print(json.dumps({"ok": False, "message": "No CUDA-capable device was reported by CTranslate2."}))
                return 1
        except Exception as exc:  # pragma: no cover - runtime environment dependent
            print(json.dumps({"ok": False, "message": str(exc)}))
            return 1

    payload = {
        "ok": True,
        "python_version": sys.version.split()[0],
        "faster_whisper_version": safe_version("faster-whisper"),
        "ctranslate2_version": safe_version("ctranslate2"),
        "cache_dir": args.cache_dir,
        "device_requested": args.device,
        "cuda_device_count": cuda_device_count,
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def runner_transcribe(args):
    try:
        from faster_whisper import WhisperModel
        from huggingface_hub.errors import LocalEntryNotFoundError
    except Exception as exc:  # pragma: no cover - runtime environment dependent
        print(str(exc), file=sys.stderr)
        return 1

    language = None if args.language == "auto" else args.language
    model_kwargs = {
        "device": args.device,
        "download_root": args.cache_dir,
        "local_files_only": args.local_files_only,
    }
    if args.cpu_threads and args.cpu_threads > 0:
        model_kwargs["cpu_threads"] = args.cpu_threads
    try:
        model = WhisperModel(args.model, **model_kwargs)
    except LocalEntryNotFoundError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "code": "DownloadRequired",
                    "retryable": True,
                    "message": (
                        "faster-whisper 模型不可用。"
                        + (
                            " 当前已禁用联网下载，请先下载模型或启用下载后重试。"
                            if args.local_files_only
                            else " 无法从 Hugging Face 下载模型，请检查网络、代理或证书后重试。"
                        )
                    ),
                    "detail": str(exc),
                },
                ensure_ascii=False,
            )
        )
        return 1
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "code": "RuntimeError",
                    "retryable": True,
                    "message": str(exc),
                },
                ensure_ascii=False,
            )
        )
        return 1
    segments, info = model.transcribe(args.audio_path, language=language)
    payload = {
        "ok": True,
        "model": args.model,
        "device": resolve_model_device(model, args.device),
        "device_requested": args.device,
        "cpu_threads": args.cpu_threads if args.cpu_threads > 0 else None,
        "compute_type": resolve_compute_type(model),
        "detected_language": getattr(info, "language", None),
        "segments": [
            {
                "start_ms": int(round(segment.start * 1000)),
                "end_ms": int(round(segment.end * 1000)),
                "text": segment.text.strip(),
            }
            for segment in segments
        ],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def resolve_model_device(model, fallback):
    candidates = [
        getattr(model, "device", None),
        getattr(getattr(model, "model", None), "device", None),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        text = str(candidate).strip().lower()
        if "cuda" in text:
            return "cuda"
        if "cpu" in text:
            return "cpu"
    return fallback


def resolve_compute_type(model):
    candidates = [
        getattr(model, "compute_type", None),
        getattr(getattr(model, "model", None), "compute_type", None),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        text = str(candidate).strip()
        if text:
            return text
    return None


def safe_version(name):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def main():
    args = parse_args()
    if args.mode == "health":
        return runner_health(args)
    if args.mode == "transcribe":
        return runner_transcribe(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
