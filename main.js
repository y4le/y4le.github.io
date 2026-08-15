const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const preferredDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");

function getSvgRoot(media) {
  const root = media.contentDocument?.documentElement;
  return root?.namespaceURI === SVG_NAMESPACE ? root : null;
}

function getActiveColorScheme() {
  const explicitTheme = document.documentElement.dataset.theme;
  if (explicitTheme === "light" || explicitTheme === "dark") {
    return explicitTheme;
  }

  const declaredSchemes = new Set(
    getComputedStyle(document.documentElement).colorScheme.split(/\s+/),
  );
  const declaresLight = declaredSchemes.has("light");
  const declaresDark = declaredSchemes.has("dark");

  if (declaresLight !== declaresDark) {
    return declaresDark ? "dark" : "light";
  }

  return preferredDarkScheme.matches ? "dark" : "light";
}

function syncSvgColorScheme(root) {
  root.setAttribute("data-color-scheme", getActiveColorScheme());
}

function getCssAnimations(root) {
  return [...(root.ownerDocument.getAnimations?.() ?? [])];
}

function resetCssAnimation(animation) {
  animation.pause();
  animation.currentTime = 0;
}

function setCssAnimations(root, shouldPlay) {
  for (const animation of getCssAnimations(root)) {
    if (shouldPlay) {
      animation.play();
      continue;
    }

    resetCssAnimation(animation);
  }
}

function getFinishPlan(animation) {
  const effect = animation.effect;
  const timing = effect?.getTiming?.();
  const currentIteration = effect?.getComputedTiming?.().currentIteration;

  if (!effect?.updateTiming || timing == null || currentIteration == null) {
    return null;
  }

  let endingIteration = Math.floor(currentIteration) + 1;
  const alternates = timing.direction === "alternate" || timing.direction === "alternate-reverse";

  // Alternating animations return to their initial frame every second
  // iteration. Stopping there avoids a visible jump when they are reset.
  if (alternates && endingIteration % 2 !== 0) {
    endingIteration += 1;
  }

  if (Number.isFinite(timing.iterations)) {
    endingIteration = Math.min(endingIteration, timing.iterations);
  }

  if (endingIteration <= currentIteration) {
    return null;
  }

  return {
    effect,
    endingIteration,
    originalIterations: timing.iterations,
  };
}

function finishCssAnimationCycles(root, onFinish) {
  const pending = new Map();
  const plans = [];

  for (const animation of getCssAnimations(root)) {
    const plan = getFinishPlan(animation);

    if (plan) {
      plans.push({ animation, ...plan });
    } else {
      resetCssAnimation(animation);
    }
  }

  const cancel = () => {
    for (const [animation, plan] of pending) {
      animation.removeEventListener("finish", plan.handleFinish);
      plan.effect.updateTiming({ iterations: plan.originalIterations });
    }

    pending.clear();
  };

  for (const plan of plans) {
    const handleFinish = () => {
      plan.animation.removeEventListener("finish", handleFinish);
      plan.effect.updateTiming({ iterations: plan.originalIterations });
      resetCssAnimation(plan.animation);
      pending.delete(plan.animation);

      if (pending.size === 0) {
        onFinish();
      }
    };

    pending.set(plan.animation, { ...plan, handleFinish });
    plan.animation.addEventListener("finish", handleFinish);
  }

  for (const plan of plans) {
    plan.effect.updateTiming({ iterations: plan.endingIteration });
  }

  return { cancel, isPending: pending.size > 0 };
}

function playSvgAnimation(root) {
  root.unpauseAnimations?.();
  setCssAnimations(root, true);
}

function resetSvgAnimation(root) {
  root.pauseAnimations?.();
  root.setCurrentTime?.(0);
  setCssAnimations(root, false);
}

function finishSvgAnimationCycle(root, onFinish) {
  const result = finishCssAnimationCycles(root, () => {
    root.pauseAnimations?.();
    root.setCurrentTime?.(0);
    onFinish();
  });

  if (!result.isPending) {
    root.pauseAnimations?.();
    root.setCurrentTime?.(0);
  }

  return result;
}

function setupSvgCard(media) {
  const card = media.closest(".project-card");
  let isHovered = card.matches(":hover");
  let isFocused = card.matches(":focus");
  let animationState = "stopped";
  let cancelCycleFinish = null;

  const syncAnimation = () => {
    const root = getSvgRoot(media);
    if (!root) {
      return;
    }

    syncSvgColorScheme(root);

    const shouldPlay = (isHovered || isFocused) && !reducedMotion.matches;

    if (shouldPlay) {
      cancelCycleFinish?.();
      cancelCycleFinish = null;
      playSvgAnimation(root);
      animationState = "playing";
      return;
    }

    if (reducedMotion.matches) {
      cancelCycleFinish?.();
      cancelCycleFinish = null;
      resetSvgAnimation(root);
      animationState = "stopped";
      return;
    }

    if (animationState === "playing") {
      animationState = "finishing";
      const cycleFinish = finishSvgAnimationCycle(root, () => {
        cancelCycleFinish = null;
        animationState = "stopped";
      });

      if (cycleFinish.isPending) {
        cancelCycleFinish = cycleFinish.cancel;
      } else {
        animationState = "stopped";
      }

      return;
    }

    if (animationState === "stopped") {
      resetSvgAnimation(root);
    }
  };

  media.addEventListener("load", syncAnimation);
  card.addEventListener("pointerenter", () => {
    isHovered = true;
    syncAnimation();
  });
  card.addEventListener("pointerleave", () => {
    isHovered = false;
    syncAnimation();
  });
  card.addEventListener("focus", () => {
    isFocused = true;
    syncAnimation();
  });
  card.addEventListener("blur", () => {
    isFocused = false;
    syncAnimation();
  });
  reducedMotion.addEventListener("change", syncAnimation);
  syncAnimation();

  return syncAnimation;
}

const svgCardSyncs = [...document.querySelectorAll(".project-svg")].map(setupSvgCard);
const syncSvgCards = () => svgCardSyncs.forEach((sync) => sync());

new MutationObserver(syncSvgCards).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "data-theme", "style"],
});
preferredDarkScheme.addEventListener("change", syncSvgCards);
