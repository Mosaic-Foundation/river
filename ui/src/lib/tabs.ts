// The phone's bottom tabs (spec 2, phone paragraph: Feed, Circles, Following, You).
export type Tab = "feed" | "circles" | "following" | "you";

/** What the phone's Circles and Following tabs say until those flows exist (M9). */
export const TAB_PLACEHOLDERS: Record<"circles" | "following", { title: string; text: string; member: string }> = {
  circles: {
    title: "Circles",
    text: "Making and editing your own circles comes with an account. For now, pick one of this River's circles from the chips on the Feed tab.",
    member: "Editing your circles is coming next. For now, pick one of your circles from the chips on the Feed tab.",
  },
  following: {
    title: "Following",
    text: "Your Following page, with the spaces and streams you follow, comes with an account. This River shows its default follows until then.",
    member: "Your Following page, with the spaces and streams you follow, is coming next.",
  },
};
