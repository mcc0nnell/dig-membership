@RestResource(urlMapping='/v1/magic/request')
global with sharing class MagicLinkRequestApi {
    global class RequestBody {
        public String email;
        public String purpose;
        public String redirectPath;
        public String firstName;
        public String lastName;
    }

    global class ResponseBody {
        public Boolean ok;
        public String message;
        public Boolean throttled;
    }

    @HttpPost
    global static ResponseBody requestLink() {
        RestResponse response = RestContext.response;
        if (response == null) {
            response = new RestResponse();
            RestContext.response = response;
        }

        RequestBody request = parseRequest();
        String email = request == null ? null : request.email;
        String purpose = request == null ? null : request.purpose;
        String redirectPath = request == null ? null : request.redirectPath;

        MagicLinkService.MagicLinkIssueResult issueResult = MagicLinkService.issue(
            email, purpose, redirectPath, null, null,
            request == null ? null : request.firstName,
            request == null ? null : request.lastName
        );

        ResponseBody out = new ResponseBody();
        out.ok = issueResult.ok;
        out.message = issueResult.message;
        out.throttled = issueResult.throttled;

        response.statusCode = 200;
        return out;
    }

    @TestVisible
    private static RequestBody parseRequest() {
        RestRequest request = RestContext.request;
        if (request == null || request.requestBody == null) {
            return null;
        }

        String body = request.requestBody.toString();
        if (String.isBlank(body)) {
            return null;
        }

        return (RequestBody) JSON.deserialize(body, RequestBody.class);
    }
}
