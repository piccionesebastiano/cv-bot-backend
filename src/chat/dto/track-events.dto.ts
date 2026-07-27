import {
  IsString,
  IsIn,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ArrayNotEmpty,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EVENT_NAMES, EVENT_SOURCES, EventName, EventSource } from '../analytics.service';

export class TrackEventDto {
  @IsIn(EVENT_NAMES as unknown as string[], { message: 'Evento non riconosciuto.' })
  name: EventName;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  /** Chip text or message text, depending on the event. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string;

  /** Page the widget was embedded in — pathname + hash, never the full URL. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  page?: string;

  @IsOptional()
  @IsIn(EVENT_SOURCES as unknown as string[])
  source?: EventSource;
}

export class TrackEventsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30, { message: 'Batch troppo grande (max 30 eventi).' })
  @ValidateNested({ each: true })
  @Type(() => TrackEventDto)
  events: TrackEventDto[];
}
