<script setup lang="ts">
import type { useTtsSleepTimer } from '../composables/useTtsSleepTimer'

type SleepTimerInstance = ReturnType<typeof useTtsSleepTimer>

const props = defineProps<{ sleepTimer: SleepTimerInstance }>()

function handlePreset(minutes: number) {
  props.sleepTimer.startTimer(minutes)
}

function handleCancel() {
  props.sleepTimer.cancelTimer()
}
</script>

<template>
  <div class="space-y-2 pt-2 border-t border-border">
    <div class="text-xs text-muted-foreground font-medium">Sleep Timer</div>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="minutes in props.sleepTimer.presets"
        :key="minutes"
        class="px-3 py-1.5 rounded-full text-sm border transition-colors"
        :class="
          props.sleepTimer.activeMinutes.value === minutes
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border hover:bg-accent text-foreground'
        "
        @click="handlePreset(minutes)"
      >
        {{ minutes }}m
      </button>
      <button
        v-if="props.sleepTimer.activeMinutes.value !== null"
        class="px-3 py-1.5 rounded-full text-sm border border-border hover:bg-accent text-destructive"
        @click="handleCancel"
      >
        Cancel
      </button>
    </div>
    <div v-if="props.sleepTimer.remainingSeconds.value !== null" class="text-sm text-muted-foreground">
      Stops in {{ Math.floor(props.sleepTimer.remainingSeconds.value / 60) }}m {{ props.sleepTimer.remainingSeconds.value % 60 }}s
    </div>
  </div>
</template>
