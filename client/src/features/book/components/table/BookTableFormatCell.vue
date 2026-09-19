<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Headphones } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFormatColor } from '@/features/book/lib/format-colors'
import type { BookFileRef } from '@bookorbit/types'
import { hasAnyReadAlong, isReadAlongFormat, READ_ALONG_FORMAT_COLOR, READ_ALONG_FORMAT_TITLE } from '@/features/book/lib/file-capabilities'

const { t } = useI18n()

const props = defineProps<{
  files: BookFileRef[]
}>()

const formattedFiles = computed(() => {
  const primary = props.files.find((file) => file.role === 'primary')
  const ordered = primary ? [primary, ...props.files.filter((file) => file.id !== primary.id)] : props.files
  return ordered.filter((file) => file.format?.trim())
})

const formats = computed(() => {
  const seen = new Set<string>()
  return formattedFiles.value.reduce<string[]>((result, file) => {
    const normalized = file.format!.trim().toLowerCase()
    if (seen.has(normalized)) return result
    seen.add(normalized)
    result.push(normalized)
    return result
  }, [])
})

const hasReadAlongCapability = computed(() => hasAnyReadAlong(formattedFiles.value))

function formatIsReadAlong(format: string): boolean {
  return isReadAlongFormat(format, hasReadAlongCapability.value)
}

function formatBadgeStyle(format: string): Record<string, string> {
  return {
    backgroundColor: formatIsReadAlong(format) ? READ_ALONG_FORMAT_COLOR : getFormatColor(format.toLowerCase()),
  }
}

const visibleFormats = computed(() => {
  const visible = formats.value.slice(0, 2)
  const readAlongFormat = formats.value.find((format) => formatIsReadAlong(format))
  if (!readAlongFormat || visible.includes(readAlongFormat)) return visible
  return [readAlongFormat, ...visible].slice(0, 2)
})
</script>

<template>
  <Tooltip v-if="formats.length > 0">
    <TooltipTrigger as-child>
      <div class="flex items-center gap-0.5">
        <span
          v-for="fmt in visibleFormats"
          :key="fmt"
          class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
          :style="formatBadgeStyle(fmt)"
          :title="formatIsReadAlong(fmt) ? READ_ALONG_FORMAT_TITLE : undefined"
        >
          {{ fmt }}
          <Headphones v-if="formatIsReadAlong(fmt)" class="size-2.5 shrink-0" :stroke-width="2.5" aria-hidden="true" />
        </span>
        <span v-if="formats.length > visibleFormats.length" class="ml-0.5 text-xs text-muted-foreground"
          >+{{ formats.length - visibleFormats.length }}</span
        >
      </div>
    </TooltipTrigger>
    <TooltipContent>
      <div v-for="file in formattedFiles" :key="file.id" class="text-xs">{{ file.format ?? t('book.table.format.unknown') }} ({{ file.role }})</div>
      <div v-if="hasReadAlongCapability" class="text-xs">{{ READ_ALONG_FORMAT_TITLE }}</div>
    </TooltipContent>
  </Tooltip>
  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
