<script setup lang="ts">
const props = defineProps<{ speed: number }>()
const emit = defineEmits<{ 'update:speed': [speed: number] }>()

const PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]

function handleSliderInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  emit('update:speed', value)
}

function handlePreset(value: number) {
  emit('update:speed', value)
}
</script>

<template>
  <div class="space-y-3 pt-2 border-t border-border">
    <div class="flex items-center justify-between text-sm text-muted-foreground">
      <span>0.25x</span>
      <span class="font-semibold text-foreground text-base">{{ props.speed }}x</span>
      <span>4x</span>
    </div>
    <input type="range" min="0.25" max="4" step="0.25" :value="props.speed" class="w-full accent-primary" @input="handleSliderInput" />
    <div class="flex flex-wrap gap-2 justify-center">
      <button
        v-for="preset in PRESETS"
        :key="preset"
        class="px-2.5 py-1 rounded-full text-xs border transition-colors"
        :class="props.speed === preset ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent text-foreground'"
        @click="handlePreset(preset)"
      >
        {{ preset }}x
      </button>
    </div>
  </div>
</template>
