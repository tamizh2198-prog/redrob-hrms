import { BadRequestError, HttpError, NotFoundError } from "./errors";

describe("errors", () => {
  it("sets the right status code per subclass", () => {
    expect(new BadRequestError().status).toBe(400);
    expect(new NotFoundError().status).toBe(404);
  });

  it("is an instance of HttpError", () => {
    expect(new BadRequestError()).toBeInstanceOf(HttpError);
  });
});
