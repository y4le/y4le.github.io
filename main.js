const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_FONT_STYLE_ID = "yalethomas-card-fonts";
const SVG_FONT_CSS = `
  @font-face {
    font-family: "Geist";
    font-style: normal;
    font-weight: 100 900;
    font-display: block;
    src: url("../../fonts/geist-latin-wght-normal.woff2") format("woff2");
  }

  @font-face {
    font-family: "Geist Mono";
    font-style: normal;
    font-weight: 100 900;
    font-display: block;
    src: url("../../fonts/geist-mono-latin-wght-normal.woff2") format("woff2");
  }
`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const preferredDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const wordmark = document.querySelector(".wordmark");
const wordmarkDot = document.querySelector(".wordmark-dot");
const helpToggle = document.querySelector(".help-toggle");
const helpToggleMark = document.querySelector(".help-toggle-mark");
const helpStatus = document.getElementById("help-status");
let isWordmarkDotHovered = wordmarkDot?.matches(":hover") ?? false;
let isWordmarkPressed = false;
let isHelpVisible = false;

function setHelpVisible(shouldShow, { announce = false } = {}) {
  isHelpVisible = shouldShow;
  document.documentElement.dataset.help = shouldShow ? "on" : "off";
  helpToggle?.setAttribute("aria-pressed", String(shouldShow));
  const action = shouldShow ? "Hide project descriptions" : "Show project descriptions";
  helpToggle?.setAttribute("aria-label", action);
  if (helpToggle) {
    helpToggle.title = `${action} (keyboard: ?)`;
  }
  if (helpToggleMark) helpToggleMark.textContent = shouldShow ? "×" : "?";

  if (announce && helpStatus) {
    helpStatus.textContent = shouldShow
      ? "Project descriptions shown."
      : "Project descriptions hidden.";
  }
}

function getSvgRoot(media) {
  const root = media.contentDocument?.documentElement;
  return root?.namespaceURI === SVG_NAMESPACE ? root : null;
}

function ensureSvgFonts(root) {
  const document = root.ownerDocument;
  if (document.getElementById(SVG_FONT_STYLE_ID)) return;

  const style = document.createElementNS(SVG_NAMESPACE, "style");
  style.id = SVG_FONT_STYLE_ID;
  style.textContent = SVG_FONT_CSS;
  root.prepend(style);
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

function getCyclePlan(animation) {
  const effect = animation.effect;
  const timing = effect?.getTiming?.();

  if (!effect?.updateTiming || timing == null) {
    return null;
  }

  const alternates = timing.direction === "alternate" || timing.direction === "alternate-reverse";
  let endingIteration = alternates ? 2 : 1;

  if (Number.isFinite(timing.iterations)) {
    endingIteration = Math.min(endingIteration, timing.iterations);
  }

  if (endingIteration <= 0) {
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

function playCssAnimationCycles(root, onFinish, shouldRepeat) {
  const pending = new Map();
  const plans = [];

  for (const animation of getCssAnimations(root)) {
    const plan = getCyclePlan(animation);

    if (!plan) {
      resetCssAnimation(animation);
      continue;
    }

    plans.push({ animation, ...plan });
  }

  const restoreAnimations = () => {
    for (const plan of plans) {
      plan.effect.updateTiming({ iterations: plan.originalIterations });
      resetCssAnimation(plan.animation);
    }
  };

  for (const plan of plans) {
    const handleFinish = () => {
      if (shouldRepeat()) {
        resetCssAnimation(plan.animation);
        plan.animation.play();
        return;
      }

      plan.animation.removeEventListener("finish", handleFinish);
      pending.delete(plan.animation);

      if (pending.size === 0) {
        restoreAnimations();
        onFinish();
      }
    };

    pending.set(plan.animation, { ...plan, handleFinish });
    plan.animation.addEventListener("finish", handleFinish);
    plan.effect.updateTiming({ iterations: plan.endingIteration });
    plan.animation.play();
  }

  const cancel = () => {
    for (const [animation, plan] of pending) {
      animation.removeEventListener("finish", plan.handleFinish);
    }

    pending.clear();
    restoreAnimations();
  };

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

function playSvgAnimationCycle(root, onFinish, shouldRepeat) {
  resetSvgAnimation(root);
  root.unpauseAnimations?.();

  const result = playCssAnimationCycles(
    root,
    () => {
      root.pauseAnimations?.();
      root.setCurrentTime?.(0);
      onFinish();
    },
    shouldRepeat,
  );

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
  let cancelTriggeredCycle = null;
  let shouldTriggerOnLoad = false;

  const syncAnimation = () => {
    if (reducedMotion.matches) {
      shouldTriggerOnLoad = false;
    }

    const root = getSvgRoot(media);
    if (!root) {
      return;
    }

    ensureSvgFonts(root);
    syncSvgColorScheme(root);

    const shouldPlay =
      (isHovered || isFocused || isWordmarkDotHovered) && !reducedMotion.matches;

    if (animationState === "triggering") {
      if (reducedMotion.matches) {
        cancelTriggeredCycle?.();
        cancelTriggeredCycle = null;
        resetSvgAnimation(root);
        animationState = "stopped";
      }

      return;
    }

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

  const triggerAnimationCycle = () => {
    if (reducedMotion.matches) {
      shouldTriggerOnLoad = false;
      return;
    }

    const root = getSvgRoot(media);
    if (!root) {
      shouldTriggerOnLoad = true;
      return;
    }

    shouldTriggerOnLoad = false;
    cancelCycleFinish?.();
    cancelCycleFinish = null;
    cancelTriggeredCycle?.();
    cancelTriggeredCycle = null;
    animationState = "triggering";

    const triggeredCycle = playSvgAnimationCycle(
      root,
      () => {
        cancelTriggeredCycle = null;
        animationState = "stopped";
        syncAnimation();
      },
      () => isWordmarkPressed,
    );

    if (triggeredCycle.isPending) {
      cancelTriggeredCycle = triggeredCycle.cancel;
    } else {
      animationState = "stopped";
      syncAnimation();
    }
  };

  media.addEventListener("load", () => {
    syncAnimation();

    if (shouldTriggerOnLoad) {
      triggerAnimationCycle();
    }
  });
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

  return { syncAnimation, triggerAnimationCycle };
}

const svgCards = [...document.querySelectorAll(".project-svg")].map(setupSvgCard);
const syncSvgCards = () => svgCards.forEach(({ syncAnimation }) => syncAnimation());
const triggerSvgCards = () => {
  for (const { triggerAnimationCycle } of svgCards) {
    triggerAnimationCycle();
  }
};

setHelpVisible(false);
helpToggle?.addEventListener("click", () => {
  setHelpVisible(!isHelpVisible);
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) {
    return;
  }

  if (event.key === "Escape" && isHelpVisible) {
    setHelpVisible(false, { announce: document.activeElement !== helpToggle });
    return;
  }

  if (event.key !== "?") return;
  const activeElement = document.activeElement;
  const acceptsText = activeElement?.isContentEditable
    || /^(INPUT|SELECT|TEXTAREA)$/.test(activeElement?.tagName ?? "");
  if (acceptsText) return;

  event.preventDefault();
  setHelpVisible(!isHelpVisible, { announce: true });
});

wordmark?.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) {
    return;
  }

  isWordmarkPressed = true;
  wordmark.setPointerCapture?.(event.pointerId);
  triggerSvgCards();
});
wordmark?.addEventListener("pointerup", (event) => {
  if (event.isPrimary && event.button === 0) {
    isWordmarkPressed = false;
  }
});
wordmark?.addEventListener("pointercancel", () => {
  isWordmarkPressed = false;
});
wordmark?.addEventListener("click", (event) => {
  // Pointer presses begin playback on pointerdown. A zero-detail click comes
  // from a keyboard or other non-pointer activation and still needs a cycle.
  if (event.detail === 0) {
    triggerSvgCards();
  }
});

wordmarkDot?.addEventListener("pointerenter", () => {
  isWordmarkDotHovered = true;
  syncSvgCards();
});
wordmarkDot?.addEventListener("pointerleave", () => {
  isWordmarkDotHovered = false;
  syncSvgCards();
});

new MutationObserver(syncSvgCards).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "data-theme", "style"],
});
preferredDarkScheme.addEventListener("change", syncSvgCards);
