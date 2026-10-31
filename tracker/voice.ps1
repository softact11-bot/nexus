# NEXUS voice input (voice.js): Windows' built-in offline recognizer (System.Speech, en-US). Default microphone only.
# Prints one JSON line per event: {t:'ready'} {t:'speech'} {t:'level',v:0-100} {t:'text',x,c} {t:'end'} {t:'error',x}. No audio is saved.
param([ValidateSet('ptt', 'free', 'wake')][string]$mode = 'ptt')
$ErrorActionPreference = 'Stop'
function emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine (New-Object System.Globalization.CultureInfo 'en-US')
  $e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $w = New-Object System.Speech.Recognition.GrammarBuilder; $w.Append((New-Object System.Speech.Recognition.Choices -ArgumentList (, [string[]]@('nexus', 'hey nexus', 'nexus stop'))))
  $e.LoadGrammar((New-Object System.Speech.Recognition.Grammar $w))
  $e.SetInputToDefaultAudioDevice()
  $e.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(700)
  $e.InitialSilenceTimeout = [TimeSpan]::FromSeconds($(if ($mode -eq 'ptt') { 8 } else { 0 }))
} catch { emit @{ t = 'error'; x = $_.Exception.Message }; exit 1 }
$null = Register-ObjectEvent $e SpeechRecognized -SourceIdentifier rec
$null = Register-ObjectEvent $e AudioLevelUpdated -SourceIdentifier lvl
$null = Register-ObjectEvent $e SpeechDetected -SourceIdentifier det
$null = Register-ObjectEvent $e RecognizeCompleted -SourceIdentifier fin
$e.RecognizeAsync($(if ($mode -eq 'ptt') { 'Single' } else { 'Multiple' }))
emit @{ t = 'ready'; mode = $mode }
$last = 0
while ($true) {
  $ev = Wait-Event -Timeout 1; if (-not $ev) { continue }
  Remove-Event -EventIdentifier $ev.EventIdentifier
  switch ($ev.SourceIdentifier) {
    'rec' { $r = $ev.SourceEventArgs.Result; emit @{ t = 'text'; x = $r.Text; c = [math]::Round($r.Confidence, 2) } }
    'lvl' { $now = [Environment]::TickCount; if ($now - $last -ge 80) { $last = $now; emit @{ t = 'level'; v = $ev.SourceEventArgs.AudioLevel } } }
    'det' { emit @{ t = 'speech' } }
    'fin' { $a = $ev.SourceEventArgs; if ($a.Error) { emit @{ t = 'error'; x = $a.Error.Message } }; emit @{ t = 'end' }; exit 0 }
  }
}
