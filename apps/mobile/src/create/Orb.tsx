import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

/**
 * O orbe do mockup 2: duas camadas de luz girando devagar e "respirando".
 * Movimento contínuo só enquanto algo está sendo construído.
 */
export function Orb({ size = 180, active = true }: { size?: number; active?: boolean }) {
  const spin = useSharedValue(0);
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (!active) return;
    spin.value = withRepeat(withTiming(360, { duration: 9000, easing: Easing.linear }), -1);
    breathe.value = withRepeat(withSequence(withTiming(1.06, { duration: 1600 }), withTiming(0.96, { duration: 1600 })), -1, true);
  }, [active, spin, breathe]);

  const outer = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }, { scale: breathe.value }] }));
  const inner = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 1.6}deg` }] }));

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[styles.layer, { width: size, height: size, borderRadius: size / 2 }, outer]}>
        <LinearGradient
          colors={["rgba(91,141,239,0.9)", "rgba(139,92,246,0.55)", "rgba(7,7,10,0)"]}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View style={[styles.layer, { width: size * 0.72, height: size * 0.72, borderRadius: size }, inner]}>
        <LinearGradient
          colors={["rgba(255,255,255,0.0)", "rgba(196,181,253,0.55)", "rgba(91,141,239,0.15)"]}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", overflow: "hidden", opacity: 0.9 },
});
