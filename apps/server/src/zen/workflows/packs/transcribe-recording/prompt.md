Transcribe the recording {{recording}} (spoken language: {{language}}).

1. Run the prepared transcriber (it writes `transcript.md` next to the recording):
   `whisper-python "$ZEN_WORKFLOW_DIR/transcribe.py" "{{recording}}" --language "{{language}}" --model "$ZEN_WHISPER_MODEL_BASE"`
   If `whisper-python` is not found, use its absolute path from the list at the end of this message.
2. Read `transcript.md` and write `summary.md` next to it: a five-line summary, then decisions and action items with owners.{{#summary}} Focus on: {{summary}}{{/summary}}
3. Answer with the summary and the paths of both files. Do not install anything.
