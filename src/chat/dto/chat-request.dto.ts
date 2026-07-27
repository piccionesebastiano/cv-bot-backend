import { IsString, IsNotEmpty, MaxLength, IsArray, IsOptional, ValidateNested, IsIn, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

class HistoryMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Il messaggio non può essere vuoto.' })
  @MaxLength(500, { message: 'Messaggio troppo lungo (max 500 caratteri).' })
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'History troppo lunga (max 20 messaggi).' })
  @ValidateNested({ each: true })
  @Type(() => HistoryMessageDto)
  history?: HistoryMessageDto[];
}
