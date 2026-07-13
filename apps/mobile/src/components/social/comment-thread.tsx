/**
 * Comments on a paddle: an ascending list (avatar, name, relative timestamp, body) with an
 * author-only delete, and a composer at the bottom. Posts via `social.commentAdd` with a
 * client-generated id -- the same `getRandomUUID` helper the offline paddle-save queue uses (see
 * ../../lib/uuid.ts), so this rides the same idempotent-by-id contract the server already
 * guarantees. New comments append optimistically into the `commentsList` query cache and are
 * reconciled with the server row on success (or rolled back on failure); deletes remove
 * optimistically and roll back on error.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "../../lib/auth-client";
import { formatDateTime } from "../../lib/format";
import { api, type RouterOutputs } from "../../lib/trpc";
import { getRandomUUID } from "../../lib/uuid";
import { Avatar } from "../ui/avatar";

type Comment = RouterOutputs["social"]["commentsList"][number];

/** e.g. "just now" / "5m ago" / "3h ago" / "2d ago", falling back to `formatDateTime` past a week. */
function formatRelativeShort(date: Date): string {
  const diffS = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return formatDateTime(date);
}

function CommentRow({
  comment,
  isOwn,
  deleting,
  onDelete,
}: {
  comment: Comment;
  isOwn: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <View className="flex-row items-start gap-2">
      <Avatar name={comment.user.name} image={comment.user.image} size="sm" />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-shrink font-semibold text-river-900"
            numberOfLines={1}
          >
            {comment.user.name}
          </Text>
          <Text className="text-xs text-river-400">
            {formatRelativeShort(new Date(comment.createdAt))}
          </Text>
        </View>
        <Text className="mt-0.5 text-sm text-river-700">{comment.body}</Text>
      </View>
      {isOwn ? (
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          accessibilityLabel="Delete comment"
          className="h-7 w-7 items-center justify-center"
        >
          <Text className="text-base text-river-400">{deleting ? "…" : "×"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface CommentThreadProps {
  paddleId: string;
  /** Called when the composer gains focus, so a screen that embeds this inside a `ScrollView` (there's
   * no room here for a screen-wide `KeyboardAvoidingView` -- the paddle detail screen also has a fixed-
   * height map above the scroll area) can scroll the composer above the keyboard itself. */
  onComposerFocus?: () => void;
}

export function CommentThread({ paddleId, onComposerFocus }: CommentThreadProps) {
  const { data: session } = authClient.useSession();
  const utils = api.useUtils();
  const commentsQuery = api.social.commentsList.useQuery({ paddleId });

  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const addComment = api.social.commentAdd.useMutation({
    // Reconcile the optimistic row with the server's (same id, authoritative createdAt).
    onSuccess: (row) => {
      utils.social.commentsList.setData({ paddleId }, (prev) =>
        prev ? prev.map((c) => (c.id === row.id ? row : c)) : prev,
      );
    },
    onError: (_err, variables) => {
      utils.social.commentsList.setData({ paddleId }, (prev) =>
        prev ? prev.filter((c) => c.id !== variables.id) : prev,
      );
    },
  });

  const deleteComment = api.social.commentDelete.useMutation({
    onMutate: async ({ id }) => {
      setDeletingId(id);
      await utils.social.commentsList.cancel({ paddleId });
      const previous = utils.social.commentsList.getData({ paddleId });
      utils.social.commentsList.setData({ paddleId }, (prev) =>
        prev ? prev.filter((c) => c.id !== id) : prev,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        utils.social.commentsList.setData({ paddleId }, context.previous);
      }
    },
    onSettled: () => setDeletingId(null),
  });

  function handleSend() {
    const body = draft.trim();
    if (!body || !session?.user) return;

    const id = getRandomUUID();
    setDraft("");

    const optimistic: Comment = {
      id,
      body,
      createdAt: new Date(),
      user: {
        id: session.user.id,
        name: session.user.name,
        image: session.user.image ?? null,
      },
    };
    utils.social.commentsList.setData({ paddleId }, (prev) =>
      prev ? [...prev, optimistic] : [optimistic],
    );

    addComment.mutate({ id, paddleId, body });
  }

  const comments = commentsQuery.data ?? [];

  return (
    <View className="gap-3">
      <Text className="text-xs font-bold uppercase tracking-widest text-river-500">
        Questions & comments
      </Text>

      {commentsQuery.isPending ? (
        <ActivityIndicator color="#1f7796" />
      ) : comments.length === 0 ? (
        <Text className="text-sm italic text-river-400">
          No comments yet — ask a question or leave a note for the crew.
        </Text>
      ) : (
        <View className="gap-3">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              isOwn={comment.user.id === session?.user.id}
              deleting={deletingId === comment.id}
              onDelete={() => deleteComment.mutate({ id: comment.id })}
            />
          ))}
        </View>
      )}

      <View className="flex-row items-end gap-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onFocus={onComposerFocus}
          placeholder="Add a comment…"
          placeholderTextColor="#88cde2"
          multiline
          maxLength={1000}
          className="min-h-11 flex-1 rounded-2xl border border-river-200 bg-white px-3 py-2 text-sm text-river-900"
        />
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim() || addComment.isPending}
          className="min-h-11 items-center justify-center rounded-xl bg-sunset-500 px-4 disabled:opacity-50"
        >
          <Text className="font-bold text-white">Send</Text>
        </Pressable>
      </View>
    </View>
  );
}
