/** Korean particles (조사) for template prose. */
/** Korean particle by the last syllable's final consonant (받침): 은/는, 이/가, 을/를, 으로/로. */
export function josa(word: string, pair: "은/는" | "이/가" | "을/를" | "으로/로"): string {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  let batchim: boolean;
  let rieul = false;
  if (code >= 0 && code <= 11171) {
    const jong = code % 28;
    batchim = jong !== 0;
    rieul = jong === 8;
  } else {
    batchim = /[0-9LMNlmn136780]$/.test(ch); // digits/latin read aloud: 일·삼·육·칠·팔·영, 엘·엠·엔
  }
  const [withB, without] = pair.split("/");
  if (pair === "으로/로") return word + (batchim && !rieul ? withB : without);
  return word + (batchim ? withB : without);
}
