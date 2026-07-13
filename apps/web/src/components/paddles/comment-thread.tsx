"use client";

/**
 * "Questions & comments" on a paddle: a live-ish list (`social.commentsList`) plus a composer.
 * Posting is optimistic -- the new comment appears immediately (client-generated uuid so a retry
 * can't double-post) and is reconciled with the server row on success, or rolled back on failure.
 * Only the comment's own author gets a delete affordance.
 */
import { useState } from "react";

import { Avatar } from "~/components/ui/avatar";
import { api, type RouterOutputs } from "~/trpc/react";

type CommentRow = RouterOutputs["social"]["commentsList"][number];

function relativeTime(when: string | Date): string {
  const ms = new Date(when).getTime();
  const diffS = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(when).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function CommentThread({
  paddleId,
  myUserId,
}: {
  paddleId: string;
  myUserId: string | undefined;
}) {
  const utils = api.useUtils();
  const commentsQuery = api.social.commentsList.useQuery({ paddleId });
  const [draft, setDraft] = useState("");

  const addComment = api.social.commentAdd.useMutation({
    onSuccess: (row) => {
      utils.social.commentsList.setData({ paddleId }, (prev) => {
        if (!prev) return prev;
        // Swap the optimistic placeholder for the confirmed server row (dedupe by id, since a
        // retry replays the same client-generated id).
        return prev.map((c) => (c.id === row.id ? row : c));
      });
    },
    onError: (_err, variables) => {
      utils.social.commentsList.setData({ paddleId }, (prev) =>
        prev?.filter((c) => c.id !== variables.id),
      );
    },
  });

  const deleteComment = api.social.commentDelete.useMutation({
    onMutate: async (variables) => {
      await utils.social.commentsList.cancel({ paddleId });
      const prev = utils.social.commentsList.getData({ paddleId });
      utils.social.commentsList.setData({ paddleId }, (rows) =>
        rows?.filter((c) => c.id !== variables.id),
      );
      return { prev };
    },
    onError: (_err, _variables, context) => {
      if (context?.prev) {
        utils.social.commentsList.setData({ paddleId }, context.prev);
      }
    },
  });

  function handleSend() {
    const body = draft.trim();
    if (!body || addComment.isPending) return;

    const optimistic: CommentRow = {
      id: crypto.randomUUID(),
      body,
      createdAt: new Date(),
      user: { id: myUserId ?? "me", name: "You", image: null },
    };
    utils.social.commentsList.setData({ paddleId }, (prev) => [
      ...(prev ?? []),
      optimistic,
    ]);
    setDraft("");
    addComment.mutate({ id: optimistic.id, paddleId, body });
  }

  const comments = commentsQuery.data ?? [];

  return (
    <div id="comments" className="flex flex-col gap-3">
      <h2 className="text-river-500 text-xs font-bold uppercase tracking-widest">
        Questions & comments
      </h2>

      {commentsQuery.isLoading ? (
        <p className="text-river-400 text-sm">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="text-river-400 text-sm italic">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <Avatar name={c.user.name ?? "Someone"} image={c.user.image} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="text-river-950 text-sm font-semibold">
                    {c.user.name ?? "Someone"}
                  </span>
                  <span className="text-river-400 text-xs">
                    {relativeTime(c.createdAt)}
                  </span>
                </p>
                <p className="text-river-700 whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
              {myUserId && c.user.id === myUserId ? (
                <button
                  type="button"
                  onClick={() => deleteComment.mutate({ id: c.id })}
                  aria-label="Delete comment"
                  className="text-river-400 hover:text-river-600 shrink-0 px-1 text-sm"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Ask a question or leave a comment…"
          className="text-river-950 placeholder:text-river-400 focus:border-river-400 min-h-10 w-full flex-1 resize-none rounded-xl border border-river-200 bg-white px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!draft.trim() || addComment.isPending}
          className="bg-sunset-500 active:bg-sunset-600 shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
