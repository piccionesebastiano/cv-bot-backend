export const INJECTION_PATTERNS: RegExp[] = [
  // Istruzioni esplicite (IT + EN)
  /ignora\s+(le\s+)?(istruzioni|regole|tutto)/i,
  /ignore\s+(previous|all|above|prior|your)\s+instructions/i,
  /dimentica\s+(tutto|le\s+istruzioni|le\s+regole|ogni\s+cosa)/i,
  /forget\s+(everything|all|your\s+instructions)/i,
  /disregard\s+(all|previous|your)/i,
  /nuove?\s+istruzioni/i,
  /new\s+instructions?/i,

  // Social engineering — identità falsa
  /sono\s+(io\s+)?(seb(astiano)?|il\s+tuo\s+(creatore|sviluppatore|admin|padrone))/i,
  /i\s+am\s+(seb(astiano)?|your\s+(creator|developer|admin|owner))/i,
  /il\s+mio\s+creatore\s+(ha\s+)?(aggiornato|detto|vuole)/i,
  /come\s+(tuo\s+)?(sviluppatore|creatore|admin)/i,

  // Cambio ruolo / modalità
  /sei\s+(ora\s+)?(un\s+)?(assistente\s+)?(generale|libero|senza\s+(filtri|restrizioni|limiti))/i,
  /you\s+are\s+now/i,
  /pretend\s+you\s+are/i,
  /modalità\s+(sviluppatore|debug|admin|senza\s+filtri|libera)/i,
  /developer\s+mode/i,
  /debug\s+mode/i,
  /senza\s+(filtri|restrizioni|limiti)/i,

  // Roleplay / ipotetico
  /facciamo\s+(un\s+)?gioco/i,
  /let'?s\s+play\s+a\s+game/i,
  /ipoteticamente\s+(se\s+)?potessi/i,

  // Richiesta di esporre il prompt
  /mostra(mi)?\s+il\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?your\s+(system\s+)?prompt/i,
  /mostra(mi)?\s+le\s+(tue\s+)?istruzioni/i,
  /ripeti\s+le\s+(tue\s+)?istruzioni/i,
  /system\s*prompt/i,
  /\[system\]/i,
  /<\s*system\s*>/i,

  // Jailbreak classici
  /jailbreak/i,
  /\bDAN\b/i,
  /do\s+anything\s+now/i,
];
