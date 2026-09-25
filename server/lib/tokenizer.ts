import {
  encode as encodeO200k,
  decode as decodeO200k,
} from "gpt-tokenizer/encoding/o200k_base";
import {
  encode as encodeCl100k,
  decode as decodeCl100k,
} from "gpt-tokenizer/encoding/cl100k_base";
import type { TokenizationResult } from "@shared/llm";

export type EncodingName = "o200k_base" | "cl100k_base";

const ENCODERS: Record<
  EncodingName,
  { encode: (text: string) => number[]; decode: (ids: number[]) => string }
> = {
  o200k_base: { encode: encodeO200k, decode: decodeO200k },
  cl100k_base: { encode: encodeCl100k, decode: decodeCl100k },
};

/**
 * Maps an OpenAI model id to its public BPE encoding. Unknown / newer models
 * default to o200k_base, which is what every OpenAI model since GPT-4o uses.
 */
export function encodingForOpenAIModel(model: string): EncodingName {
  const m = model.toLowerCase();
  if (m.startsWith("gpt-4o") || m.startsWith("gpt-4.1") || m.startsWith("gpt-5")) return "o200k_base";
  if (/^o[1-9]/.test(m) || m.startsWith("chatgpt-4o")) return "o200k_base";
  if (m.startsWith("gpt-4") || m.startsWith("gpt-3.5")) return "cl100k_base";
  return "o200k_base";
}

export function tokenize(text: string, encoding: EncodingName): { tokens: string[]; ids: number[] } {
  const enc = ENCODERS[encoding];
  const ids = enc.encode(text);
  const tokens = ids.map((id) => {
    const piece = enc.decode([id]);
    // Multi-byte characters may be split across several tokens; a lone
    // fragment decodes to U+FFFD. Show it as a byte marker instead.
    return piece.includes("�") ? "�" : piece;
  });
  return { tokens, ids };
}

export function exactTokenization(text: string, model: string): TokenizationResult {
  const encoding = encodingForOpenAIModel(model);
  const { tokens, ids } = tokenize(text, encoding);
  return {
    tokens,
    ids,
    encoding,
    exact: true,
    source: "live",
    note: `Tokenized locally with the open ${encoding} BPE, the same tokenizer OpenAI publishes for ${model}. Token ids are the real vocabulary ids.`,
  };
}

export function approximateTokenization(text: string, providerName: string): TokenizationResult {
  const encoding: EncodingName = "o200k_base";
  const { tokens, ids } = tokenize(text, encoding);
  return {
    tokens,
    ids,
    encoding,
    exact: false,
    source: "simulation",
    note: `${providerName}'s tokenizer is not public. Token boundaries and ids shown use the open ${encoding} BPE as an approximation. The real input token count is reported by the provider API.`,
  };
}
