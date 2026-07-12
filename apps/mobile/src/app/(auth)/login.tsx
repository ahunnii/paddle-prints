import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link } from "expo-router";

import { authClient } from "../../lib/auth-client";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  function handleSubmit() {
    setError(null);
    setIsPending(true);

    void authClient.signIn.email(
      { email, password },
      {
        onError: (ctx) => {
          setIsPending(false);
          setError(ctx.error.message ?? "Something went wrong. Try again.");
        },
      },
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-river-50"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 items-center justify-center px-4">
        <View className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
          <View className="mb-6 items-center gap-2">
            <Text className="text-4xl">🛶</Text>
            <Text className="text-2xl font-extrabold tracking-tight text-river-900">
              Welcome back
            </Text>
            <Text className="text-center text-sm text-river-600">
              Sign in to see your crew&apos;s routes.
            </Text>
          </View>

          <View className="gap-4">
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
                textContentType="password"
                autoComplete="password"
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
                <Text className="font-semibold text-white">Sign in</Text>
              )}
            </Pressable>
          </View>

          <View className="mt-6 flex-row flex-wrap justify-center gap-1">
            <Text className="text-sm text-river-600">New to the crew?</Text>
            <Link
              href="/register"
              className="text-sm font-semibold text-sunset-600"
            >
              Create an account
            </Link>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
