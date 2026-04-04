"use client";

type FoodArtVariant = "token" | "hero" | "compact";

type FoodKey =
  | "yogurt"
  | "oats"
  | "toast"
  | "egg"
  | "chicken"
  | "shrimp"
  | "rice"
  | "sweet_potato"
  | "broccoli"
  | "asparagus"
  | "salmon"
  | "beef"
  | "quinoa"
  | "corn"
  | "greens"
  | "avocado"
  | "nuts"
  | "olive_oil"
  | "tofu"
  | "beans"
  | "berries"
  | "milk"
  | "generic";

function resolveFoodKey(name: string): FoodKey {
  const lower = name.toLowerCase();

  if (lower.includes("yogurt")) return "yogurt";
  if (lower.includes("oat")) return "oats";
  if (lower.includes("toast") || lower.includes("bread")) return "toast";
  if (lower.includes("egg")) return "egg";
  if (lower.includes("chicken")) return "chicken";
  if (lower.includes("shrimp") || lower.includes("prawn")) return "shrimp";
  if (lower.includes("rice")) return "rice";
  if (lower.includes("sweet potato") || lower.includes("potato")) return "sweet_potato";
  if (lower.includes("broccoli")) return "broccoli";
  if (lower.includes("asparagus")) return "asparagus";
  if (lower.includes("salmon")) return "salmon";
  if (lower.includes("beef")) return "beef";
  if (lower.includes("quinoa")) return "quinoa";
  if (lower.includes("corn")) return "corn";
  if (lower.includes("greens") || lower.includes("spinach") || lower.includes("salad")) return "greens";
  if (lower.includes("avocado")) return "avocado";
  if (lower.includes("almond") || lower.includes("nuts") || lower.includes("walnut")) return "nuts";
  if (lower.includes("olive oil") || lower.includes("oil")) return "olive_oil";
  if (lower.includes("tofu")) return "tofu";
  if (lower.includes("bean") || lower.includes("edamame")) return "beans";
  if (lower.includes("berry") || lower.includes("blueberry") || lower.includes("strawberry")) return "berries";
  if (lower.includes("milk")) return "milk";

  return "generic";
}

function renderFoodShape(key: FoodKey) {
  switch (key) {
    case "yogurt":
      return (
        <>
          <ellipse cx="60" cy="80" rx="29" ry="11" fill="#b46059" opacity="0.18" />
          <path d="M27 48c0-7 6-13 13-13h40c7 0 13 6 13 13l-5 27c-2 10-11 16-21 16H53c-10 0-19-6-21-16l-5-27z" fill="#cd6e67" />
          <ellipse cx="60" cy="47" rx="32" ry="11" fill="#df837c" />
          <ellipse cx="60" cy="48" rx="27" ry="8" fill="#fff7ee" />
          <circle cx="46" cy="45" r="4" fill="#37564f" />
          <circle cx="56" cy="40" r="3.5" fill="#d96356" />
          <circle cx="68" cy="44" r="3.5" fill="#37564f" />
          <circle cx="76" cy="40" r="3.5" fill="#d96356" />
          <circle cx="61" cy="37" r="3" fill="#b79f63" />
        </>
      );
    case "oats":
      return (
        <>
          <ellipse cx="60" cy="81" rx="28" ry="10" fill="#8b5f43" opacity="0.18" />
          <path d="M28 52c0-8 7-14 15-14h34c8 0 15 6 15 14l-6 22c-3 10-12 17-21 17H55c-9 0-18-7-21-17l-6-22z" fill="#bf824f" />
          <ellipse cx="60" cy="50" rx="32" ry="11" fill="#d99b62" />
          <ellipse cx="60" cy="51" rx="27" ry="8" fill="#e8d0a1" />
          <ellipse cx="48" cy="51" rx="7" ry="3.5" fill="#cfb07c" />
          <ellipse cx="60" cy="48" rx="8" ry="3.5" fill="#d7b582" />
          <ellipse cx="73" cy="51" rx="7" ry="3.5" fill="#cea468" />
        </>
      );
    case "toast":
      return (
        <>
          <ellipse cx="60" cy="84" rx="26" ry="9" fill="#8a6d47" opacity="0.18" />
          <path d="M34 34c2-10 10-17 26-17s24 7 26 17l4 27c1 12-8 22-20 25l-10 2-10-2c-12-3-21-13-20-25l4-27z" fill="#aa6a38" />
          <path d="M40 39c2-7 8-12 20-12s18 5 20 12l3 22c1 9-5 16-13 18l-10 2-10-2c-8-2-14-9-13-18l3-22z" fill="#e5b26d" />
          <path d="M45 49c5-2 10-3 14-3 6 0 12 1 17 4" stroke="#f3cd98" strokeWidth="3" strokeLinecap="round" />
          <path d="M43 60c8-3 14-4 19-4 5 0 9 1 14 2" stroke="#f3cd98" strokeWidth="3" strokeLinecap="round" opacity="0.72" />
        </>
      );
    case "egg":
      return (
        <>
          <ellipse cx="60" cy="83" rx="25" ry="9" fill="#8c7a56" opacity="0.14" />
          <ellipse cx="60" cy="54" rx="23" ry="29" fill="#fff8ec" />
          <circle cx="60" cy="56" r="11" fill="#efb342" />
          <circle cx="60" cy="56" r="5" fill="#e19622" opacity="0.65" />
        </>
      );
    case "chicken":
      return (
        <>
          <ellipse cx="60" cy="83" rx="29" ry="10" fill="#a07960" opacity="0.18" />
          <path d="M27 58c0-18 14-31 33-31 20 0 31 13 31 26 0 20-18 34-37 34-15 0-27-10-27-29z" fill="#efc090" />
          <path d="M39 47c6-5 12-8 18-8 10 0 19 5 26 14" stroke="#cf9d6d" strokeWidth="4" strokeLinecap="round" />
          <path d="M36 61c8-6 17-9 26-9 7 0 13 2 18 5" stroke="#cd9368" strokeWidth="4" strokeLinecap="round" opacity="0.75" />
          <path d="M41 71c7-4 15-6 23-6 4 0 9 1 13 3" stroke="#c07c53" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
        </>
      );
    case "shrimp":
      return (
        <>
          <ellipse cx="60" cy="84" rx="26" ry="9" fill="#8e5c54" opacity="0.16" />
          <path d="M74 31c11 5 18 16 18 28 0 14-10 26-24 30-9 3-20 2-28-4 9 1 18-1 25-6 9-6 14-15 14-25 0-8-3-16-5-23z" fill="#f28d63" />
          <path d="M68 34c8 4 13 12 13 21 0 12-8 22-20 25-8 2-16 1-22-4 8 1 15-1 21-5 8-5 12-13 12-21 0-6-2-11-4-16z" fill="#ffb086" />
          <path d="M56 37c-8 2-13 8-16 17" stroke="#d96e46" strokeWidth="3" strokeLinecap="round" />
          <path d="M65 46c-4 0-7 1-10 3" stroke="#d96e46" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="67" cy="40" r="2.2" fill="#473630" />
        </>
      );
    case "rice":
      return (
        <>
          <ellipse cx="60" cy="82" rx="27" ry="10" fill="#857a65" opacity="0.14" />
          <path d="M33 63c0-14 12-24 27-24s27 10 27 24c0 13-12 22-27 22S33 76 33 63z" fill="#faf4ea" />
          <circle cx="49" cy="56" r="2.4" fill="#e8e0d2" />
          <circle cx="57" cy="50" r="2.4" fill="#e8e0d2" />
          <circle cx="67" cy="58" r="2.3" fill="#e8e0d2" />
          <circle cx="74" cy="51" r="2.1" fill="#e8e0d2" />
          <circle cx="53" cy="65" r="2.2" fill="#e0d8cb" />
          <circle cx="62" cy="68" r="2.2" fill="#e0d8cb" />
        </>
      );
    case "sweet_potato":
      return (
        <>
          <ellipse cx="60" cy="82" rx="27" ry="10" fill="#8b603f" opacity="0.14" />
          <ellipse cx="48" cy="58" rx="16" ry="22" transform="rotate(-18 48 58)" fill="#b5602f" />
          <ellipse cx="48" cy="58" rx="11" ry="17" transform="rotate(-18 48 58)" fill="#ffb45a" />
          <ellipse cx="70" cy="55" rx="15" ry="20" transform="rotate(20 70 55)" fill="#af5a2c" />
          <ellipse cx="70" cy="55" rx="10" ry="15" transform="rotate(20 70 55)" fill="#f7ac4c" />
        </>
      );
    case "broccoli":
      return (
        <>
          <ellipse cx="60" cy="83" rx="25" ry="9" fill="#48624b" opacity="0.16" />
          <path d="M54 72V54h12v18z" fill="#7da15f" />
          <circle cx="44" cy="47" r="13" fill="#4e7f43" />
          <circle cx="58" cy="40" r="16" fill="#5f984f" />
          <circle cx="74" cy="47" r="13" fill="#48773d" />
          <circle cx="53" cy="50" r="10" fill="#69a759" opacity="0.92" />
          <circle cx="67" cy="50" r="10" fill="#5f994f" opacity="0.92" />
        </>
      );
    case "asparagus":
      return (
        <>
          <ellipse cx="60" cy="84" rx="24" ry="8" fill="#4a6c4c" opacity="0.14" />
          <path d="M39 72l9-35" stroke="#7fa161" strokeWidth="8" strokeLinecap="round" />
          <path d="M57 78l7-39" stroke="#87aa68" strokeWidth="8" strokeLinecap="round" />
          <path d="M76 72l5-31" stroke="#759b58" strokeWidth="8" strokeLinecap="round" />
          <path d="M48 37l-5 8 8-3z" fill="#5e8448" />
          <path d="M64 39l-6 10 9-4z" fill="#688f4f" />
          <path d="M80 41l-6 9 9-4z" fill="#5f8647" />
        </>
      );
    case "salmon":
      return (
        <>
          <ellipse cx="60" cy="83" rx="28" ry="10" fill="#8a5f5a" opacity="0.16" />
          <path d="M29 61c0-20 17-33 36-33 15 0 27 8 27 20 0 18-14 38-39 38-16 0-24-9-24-25z" fill="#ff9a84" />
          <path d="M38 55c12-8 25-11 37-10" stroke="#ffd0c4" strokeWidth="4" strokeLinecap="round" />
          <path d="M39 65c10-5 21-7 32-7" stroke="#ffd0c4" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
          <path d="M42 74c8-3 16-4 24-4" stroke="#ffd0c4" strokeWidth="3.5" strokeLinecap="round" opacity="0.8" />
        </>
      );
    case "beef":
      return (
        <>
          <ellipse cx="60" cy="83" rx="28" ry="10" fill="#7d4f49" opacity="0.16" />
          <path d="M30 60c0-17 13-30 32-30 18 0 30 11 30 25 0 17-16 31-34 31-17 0-28-9-28-26z" fill="#93483d" />
          <path d="M41 54c7-6 14-9 22-9 10 0 19 4 24 10" stroke="#d07d72" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M39 66c10-6 20-8 30-6" stroke="#d07d72" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        </>
      );
    case "quinoa":
      return (
        <>
          <ellipse cx="60" cy="81" rx="28" ry="11" fill="#86735f" opacity="0.16" />
          <path d="M31 58c0-13 13-22 29-22 17 0 29 9 29 22 0 15-12 25-29 25-16 0-29-10-29-25z" fill="#d9bf97" />
          <circle cx="46" cy="53" r="2.4" fill="#f3e7d0" />
          <circle cx="55" cy="47" r="2.2" fill="#ead8b8" />
          <circle cx="65" cy="50" r="2.5" fill="#f3e7d0" />
          <circle cx="73" cy="58" r="2.1" fill="#ead8b8" />
          <circle cx="54" cy="61" r="2.3" fill="#f3e7d0" />
          <circle cx="63" cy="66" r="2.2" fill="#ead8b8" />
        </>
      );
    case "corn":
      return (
        <>
          <ellipse cx="60" cy="84" rx="25" ry="8" fill="#866b3b" opacity="0.14" />
          <path d="M42 38c6-8 12-12 18-12s12 4 18 12v28c0 11-8 20-18 20s-18-9-18-20V38z" fill="#f6c64f" />
          <path d="M42 42c-6 8-7 18-4 29 2 7 7 13 14 17-11-2-19-12-19-24 0-10 4-19 9-22z" fill="#7aa557" />
          <path d="M78 42c6 8 7 18 4 29-2 7-7 13-14 17 11-2 19-12 19-24 0-10-4-19-9-22z" fill="#6e9850" />
          <path d="M51 37v36M60 33v42M69 37v36" stroke="#ffd56d" strokeWidth="4" strokeLinecap="round" />
        </>
      );
    case "greens":
      return (
        <>
          <ellipse cx="60" cy="82" rx="29" ry="10" fill="#4f6650" opacity="0.15" />
          <path d="M31 66c0-11 13-20 29-20s29 9 29 20-13 18-29 18-29-7-29-18z" fill="#dce8d5" />
          <path d="M39 55c2-8 8-14 16-17-2 7-1 12 1 18-6 0-11 0-17-1z" fill="#4d824a" />
          <path d="M52 60c1-11 7-20 18-24-2 8 0 16 3 23-8 2-14 2-21 1z" fill="#6ea65f" />
          <path d="M66 58c3-8 10-14 18-16-2 8 0 15 2 21-8 1-14 0-20-5z" fill="#7ab067" />
          <circle cx="47" cy="59" r="3" fill="#d55c52" />
          <circle cx="71" cy="63" r="3" fill="#f3c24d" />
        </>
      );
    case "avocado":
      return (
        <>
          <ellipse cx="60" cy="84" rx="24" ry="8" fill="#53734f" opacity="0.14" />
          <path d="M60 24c16 0 28 13 28 29 0 18-14 36-28 36S32 71 32 53c0-16 12-29 28-29z" fill="#6f9c57" />
          <path d="M60 30c12 0 21 10 21 22 0 15-11 29-21 29S39 67 39 52c0-12 9-22 21-22z" fill="#c7df8b" />
          <circle cx="60" cy="55" r="9" fill="#8f5b35" />
          <circle cx="60" cy="55" r="4" fill="#73452a" opacity="0.6" />
        </>
      );
    case "nuts":
      return (
        <>
          <ellipse cx="60" cy="84" rx="25" ry="8" fill="#7f6548" opacity="0.15" />
          <ellipse cx="46" cy="59" rx="9" ry="13" transform="rotate(-18 46 59)" fill="#b27d4d" />
          <ellipse cx="61" cy="50" rx="8" ry="11" fill="#9d6b42" />
          <ellipse cx="74" cy="61" rx="10" ry="14" transform="rotate(14 74 61)" fill="#c28f5e" />
          <path d="M42 59c3 1 5 2 8 3" stroke="#d7b182" strokeWidth="2" strokeLinecap="round" />
          <path d="M70 61c3 1 5 2 8 3" stroke="#dfbd94" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "olive_oil":
      return (
        <>
          <ellipse cx="60" cy="85" rx="22" ry="7" fill="#777058" opacity="0.14" />
          <path d="M52 29h16v17l7 17c5 11-3 27-15 27s-20-16-15-27l7-17V29z" fill="#7ca453" />
          <path d="M56 34h8v13h-8z" fill="#dbeeb1" opacity="0.65" />
          <path d="M60 19c4 2 5 6 4 10h-8c-1-4 0-8 4-10z" fill="#5a7a3d" />
        </>
      );
    case "tofu":
      return (
        <>
          <ellipse cx="60" cy="84" rx="24" ry="8" fill="#8d8575" opacity="0.14" />
          <path d="M33 50l28-14 26 15-28 17z" fill="#f6f0e3" />
          <path d="M33 50v22l28 15V68z" fill="#e8dfce" />
          <path d="M87 51v21L61 87V68z" fill="#ddd2bf" />
        </>
      );
    case "beans":
      return (
        <>
          <ellipse cx="60" cy="84" rx="25" ry="8" fill="#74604e" opacity="0.14" />
          <ellipse cx="44" cy="60" rx="10" ry="14" transform="rotate(-20 44 60)" fill="#70a55d" />
          <ellipse cx="60" cy="50" rx="10" ry="14" fill="#8fca76" />
          <ellipse cx="76" cy="60" rx="10" ry="14" transform="rotate(20 76 60)" fill="#6d9e57" />
          <path d="M40 60c2 0 4-1 6-2" stroke="#d0f0b4" strokeWidth="2" strokeLinecap="round" />
          <path d="M72 60c2 0 4-1 6-2" stroke="#c3e7a3" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case "berries":
      return (
        <>
          <ellipse cx="60" cy="84" rx="24" ry="8" fill="#6c5665" opacity="0.14" />
          <circle cx="45" cy="60" r="10" fill="#3f5e94" />
          <circle cx="59" cy="48" r="10" fill="#d35556" />
          <circle cx="73" cy="61" r="10" fill="#394f86" />
          <path d="M58 36l3-7 4 7" stroke="#7ea85d" strokeWidth="2.5" strokeLinecap="round" />
        </>
      );
    case "milk":
      return (
        <>
          <ellipse cx="60" cy="85" rx="22" ry="7" fill="#848484" opacity="0.12" />
          <path d="M48 29h24v14l8 13v18c0 9-7 16-16 16H56c-9 0-16-7-16-16V56l8-13V29z" fill="#f8fafc" />
          <path d="M52 34h16v10H52z" fill="#d9eef8" />
          <path d="M48 56h32" stroke="#d4d4d4" strokeWidth="2" />
        </>
      );
    default:
      return (
        <>
          <ellipse cx="60" cy="84" rx="24" ry="8" fill="#727272" opacity="0.14" />
          <circle cx="60" cy="56" r="24" fill="#efe0c8" />
          <path d="M46 64c9-10 18-15 28-15" stroke="#ca9e68" strokeWidth="4" strokeLinecap="round" />
          <path d="M46 74c8-6 16-9 25-9" stroke="#ca9e68" strokeWidth="3.5" strokeLinecap="round" opacity="0.74" />
        </>
      );
  }
}

export function DietFoodArt({
  name,
  variant = "token",
  className = ""
}: {
  name: string;
  variant?: FoodArtVariant;
  className?: string;
}) {
  const key = resolveFoodKey(name);

  return (
    <div className={`diet-food-art ${variant} ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 120 120" role="presentation">
        {renderFoodShape(key)}
      </svg>
    </div>
  );
}
