import { Redirect } from "expo-router";
import { View } from "react-native";
import { useMorph } from "../data/MorphProvider";
import { useTheme } from "../design/theme";
import { Home } from "../home/Home";

export default function Index() {
  const morph = useMorph();
  const { colors } = useTheme();
  if (morph.status === "loading") return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  if (morph.status === "unpaired") return <Redirect href="/pair" />;
  return <Home />;
}
