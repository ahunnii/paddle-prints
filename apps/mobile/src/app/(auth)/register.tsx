import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";

import { authClient } from "../../lib/auth-client";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function handleSubmit() {
    setError(null);
    setIsPending(true);

    // better-auth's sign-up/email endpoint accepts arbitrary extra body fields (see
    // signUpEmailBodySchema in better-auth's source), but the generated client type only
    // reflects the known fields. Building the payload in a variable (rather than passing an
    // object literal) sidesteps TS's excess-property check while still sending `inviteCode` to
    // the server. Mirrors apps/web/src/app/register/page.tsx.
    const payload = { name, email, password, inviteCode };

    void authClient.signUp.email(payload, {
      onError: (ctx) => {
        setIsPending(false);
        setError(ctx.error.message ?? "Something went wrong. Try again.");
      },
    });
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-river-50"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-1 items-center justify-center px-4 py-8"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
          <View className="mb-6 items-center gap-2">
            <Text className="text-4xl">🛶</Text>
            <Text className="text-2xl font-extrabold tracking-tight text-river-900">
              Join the crew
            </Text>
            <Text className="text-center text-sm text-river-600">
              You&apos;ll need an invite code to paddle in.
            </Text>
          </View>

          <View className="gap-4">
            <View className="gap-1">
              <Text className="text-sm font-medium text-river-700">
                Name
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                textContentType="name"
                autoComplete="name"
                className="rounded-xl border border-river-200 px-4 py-3 text-river-900"
              />
            </View>

            <View className="gap-1">
              <Text className="text-sm font-medium text-river-700">
                Email
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                className="rounded-xl border border-river-200 px-4 py-3 text-river-900"
              />
            </View>

            <View className="gap-1">
              <Text className="text-sm font-medium text-river-700">
                Password
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="password-new"
                className="rounded-xl border border-river-200 px-4 py-3 text-river-900"
              />
            </View>

            <View className="gap-1">
              <Text className="text-sm font-medium text-river-700">
                Invite code
              </Text>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-xl border border-river-200 px-4 py-3 text-river-900"
              />
            </View>

            {error ? (
              <Text className="text-sm text-sunset-700">{error}</Text>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={isPending}
              className="mt-2 items-center rounded-full bg-sunset-500 px-6 py-3 disabled:opacity-60"
            >
              {isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-semibold text-white">
                  Create account
                </Text>
              )}
            </Pressable>
          </View>

          <View className="mt-6 flex-row flex-wrap justify-center gap-1">
            <Text className="text-sm text-river-600">
              Already paddling with us?
            </Text>
            <Link
              href="/login"
              className="text-sm font-semibold text-sunset-600"
            >
              Sign in
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
