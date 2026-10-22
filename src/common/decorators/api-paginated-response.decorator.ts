import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PageMeta } from '../dto/pagination.dto';

/** Documents a `PaginatedResponse<T>` ({ data: T[], meta }) — generics aren't visible to Swagger. */
export const ApiPaginatedResponse = <T extends Type<unknown>>(model: T) =>
  applyDecorators(
    ApiExtraModels(model, PageMeta),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMeta) },
        },
      },
    }),
  );
